/**
 * Claude (API de Anthropic) contra un servidor local que imita la API: nunca
 * sale a internet ni usa una clave real.
 *
 * - Clave: se comprueba, se guarda en .env, nunca se devuelve; modelo elegido
 *   de la lista de la cuenta.
 * - Buscar eventos de una web de venta (reanudando la vuelta pausada), leer un
 *   evento (límite «oficial» solo con la frase de la web de venta) y situar las
 *   zonas sobre la imagen del plano oficial.
 * - Respaldo del servidor, entrega que no llega, rechazo, API del dashboard.
 * - Crear el evento con lo que ha leído Claude (recinto nuevo con sus zonas,
 *   vigilancia, plano) y hacerlo entero desde Telegram con /evento.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Hono } from 'hono';
import { aiEventDraft, aiLayoutText, parseSaleZone, type AiEventDetails, type AiEventsResult, type AiKeyResult, type AiStatus } from '@to/shared';
import { createApp, type App } from '../app';
import { EventAssistant } from '../ai/assistant';
import { AiError, ClaudeControl } from '../ai/claude';
import { writeFixtureVault } from '../gates/fixtures';
import { createHttpApp } from '../http/app';
import { MemoryDriver } from '../store/drivers';
import { TelegramNotifier } from '../telegram/telegram';
import type { Clock } from '../util/clock';
import { SeqIdGen } from '../util/ids';
import { setLogSilent } from '../util/log';
import { VaultAuthoring } from '../vault/authoring';
import { AI_KEY, deliver, FakeAnthropic, pausedSearch } from './fake-anthropic';
import { FakeTelegram, TOKEN, until } from './fake-telegram';

/** Jueves 1 de octubre de 2026, 10:00 en Madrid. */
const NOW = Date.parse('2026-10-01T08:00:00Z');
const TZ = 'Europe/Madrid';
const JSON_HEADERS = { 'content-type': 'application/json' };
const PLAN = 'https://www.realmadrid.com/img/plano-bernabeu.png';

class ManualClock implements Clock {
  readonly virtual = true;
  constructor(public t: number) {}
  now(): number {
    return this.t;
  }
  setTimeout(): number {
    return 0;
  }
  clearTimeout(): void {}
  setInterval(): number {
    return 0;
  }
  clearInterval(): void {}
  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

async function note(root: string, rel: string, fm: string): Promise<void> {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${fm.trim()}\n---\n\n`, 'utf8');
}

/** Vault de pruebas + la web del Real Madrid y el Bernabéu (4 zonas). */
async function writeAiVault(dir: string): Promise<void> {
  await writeFixtureVault(dir);
  await note(dir, '30 Proveedores/Real Madrid.md', 'type: provider\nid: real-madrid\nname: Real Madrid\nmode: MANUAL_ASSIST\nurl: https://www.realmadrid.com/es-ES/entradas\nauthorizedCapabilities: []');
  const V = '10 Recintos/Estadio Santiago Bernabéu';
  await note(dir, `${V}/Estadio Santiago Bernabéu.md`, 'type: venue\nid: estadio-santiago-bernabeu\nname: Estadio Santiago Bernabéu\ncity: Madrid\nclub: ["Real Madrid"]\naliases: ["Bernabéu"]\nsource: prueba');
  for (const z of ['Lateral Este', 'Lateral Oeste', 'Fondo Sur', 'Fondo Norte']) {
    await note(dir, `${V}/Zonas/${z}.md`, 'type: zone');
    await note(dir, `${V}/Secciones/${z} Grada.md`, `type: section\nzone: "[[${z}]]"\nkind: SEATED`);
  }
}

const BARCA = {
  name: 'Real Madrid - FC Barcelona',
  date: '2026-10-25',
  time: '16:15',
  venue: 'Estadio Santiago Bernabéu',
  city: 'Madrid',
  url: 'https://www.realmadrid.com/es-ES/entradas/rm-barcelona',
  saleOpens: '2026-10-20T10:00',
  sourceUrl: 'https://www.realmadrid.com/es-ES/entradas',
};

function detailsInput(p: { name?: string; limitSource: string; planImage: string | null; url?: string }): Record<string, unknown> {
  return {
    name: p.name ?? BARCA.name,
    date: '2026-10-25',
    time: '16:15',
    venue: 'Estadio Santiago Bernabéu',
    city: 'Madrid',
    url: p.url ?? BARCA.url,
    seller: 'Real Madrid C. F.',
    sales: [
      { name: 'Venta general', opensAt: '2026-10-22T10:00', limit: 4 },
      { name: 'Venta socios', opensAt: '2026-10-20T10:00', limit: 2 },
    ],
    limit: { perPerson: 2, scope: 'SOCIO', quote: 'Máximo 2 entradas por socio', sourceUrl: p.limitSource },
    price: { min: 60, max: 250, currency: 'EUR' },
    layout: [
      { zone: 'Lateral Este Grada Baja', sections: ['Sector 101', 'Sector 102'], standing: false, price: '120–250 €', venueZone: 'Lateral Este' },
      { zone: 'Fondo Sur Grada Alta', sections: [], standing: false, price: '60–90 €', venueZone: 'fondo sur' },
      { zone: 'Zona VIP Castellana', sections: ['Palco 1'], standing: false, price: null, venueZone: 'Inventada' },
    ],
    planImage: p.planImage,
    status: 'UPCOMING',
    notes: 'Las entradas de socio son personales.',
    sources: [BARCA.sourceUrl],
  };
}

type Btn = { text: string; callback_data?: string; url?: string };

/** Botones del último mensaje (enviado o editado) cuyo texto casa con `re`. */
function keyboardFor(tg: FakeTelegram, re: RegExp): Btn[] {
  const m = [...tg.sent].reverse().find((s) => (s.method === 'sendMessage' || s.method === 'editMessageText') && re.test(String(s.body.text)) && s.body.reply_markup);
  return ((m?.body.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();
}

describe('Claude (API de Anthropic)', () => {
  let fake: FakeAnthropic;
  let dir = '';
  let envDir = '';
  let envFile = '';
  let app: App;
  let ai: ClaudeControl;
  let http: Hono;
  let assistant: EventAssistant;

  before(async () => {
    setLogSilent(true);
    fake = new FakeAnthropic();
    const base = await fake.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-ai-'));
    await writeAiVault(dir);
    envDir = await mkdtemp(path.join(tmpdir(), 'to-ai-env-'));
    envFile = path.join(envDir, '.env');
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    ai = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile, baseURL: base });
    const authoring = new VaultAuthoring(app);
    assistant = new EventAssistant(app, ai, authoring);
    app.runtime.ctx.eventAssistant = assistant;
    http = createHttpApp(app, { dashboardDist: null, operatorToken: null, ai, authoring });
  });

  after(async () => {
    app.runtime.ctx.notifier = null;
    await app.stop();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    await rm(envDir, { recursive: true, force: true });
    setLogSilent(false);
  });

  it('sin clave: la API lo dice claro y no se llama a Claude', async () => {
    const res = await http.request('/api/ai/events', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ providerId: 'real-madrid', days: 30 }) });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'AI_NOT_CONFIGURED');
    assert.equal(fake.requests.length, 0);
    const status = (await (await http.request('/api/ai')).json()) as AiStatus;
    assert.equal(status.configured, false);
  });

  it('una clave que no vale no se guarda', async () => {
    const r = await ai.setKey('sk-ant-api03-mala-0000000000000000000000', 'prueba');
    assert.equal(r.ok, false);
    assert.match(r.message, /no acepta la clave/);
    assert.equal(existsSync(envFile), false);
    assert.equal(ai.status().configured, false);
  });

  it('la clave buena se guarda en .env, se elige el Opus más reciente y nunca se devuelve', async () => {
    const other = await http.request('/api/ai/key', { method: 'PUT', headers: { ...JSON_HEADERS, origin: 'https://otra-web.example' }, body: JSON.stringify({ key: AI_KEY }) });
    assert.equal(other.status, 403, 'otra web no puede poner la clave');
    const res = await http.request('/api/ai/key', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ key: AI_KEY }) });
    const r = (await res.json()) as AiKeyResult;
    assert.equal(r.ok, true, r.message);
    assert.match(await readFile(envFile, 'utf8'), new RegExp(`ANTHROPIC_API_KEY=${AI_KEY}`));
    assert.equal(r.status.model, 'Opus de prueba (nuevo)');
    assert.equal(r.status.configured, true);
    for (const url of ['/api/ai', '/api/system', '/api/state']) {
      assert.ok(!(await (await http.request(url)).text()).includes(AI_KEY), `${url} no devuelve la clave`);
    }
  });

  it('busca los eventos de la web de venta: reanuda la pausa, filtra, sitúa el recinto y calcula el gasto', async () => {
    fake.script.push(
      pausedSearch('site:realmadrid.com entradas'),
      deliver('entregar_eventos', {
        events: [
          BARCA,
          { name: 'Real Madrid - Juventus', date: '2026-10-06', time: null, venue: 'Bernabéu', city: 'Madrid', url: null, saleOpens: null, sourceUrl: null },
          { name: 'Partido del año pasado', date: '2025-05-01', time: '21:00', venue: 'Bernabéu', city: 'Madrid', url: null, saleOpens: null, sourceUrl: null },
          { name: 'Gira 2027', date: '2027-03-01', time: '21:00', venue: 'Bernabéu', city: 'Madrid', url: null, saleOpens: null, sourceUrl: null },
          { name: 'Concierto en Vistalegre', date: '2026-11-02', time: '21:00', venue: 'Palacio Vistalegre', city: 'Madrid', url: 'javascript:alert(1)', saleOpens: 'pronto', sourceUrl: null },
        ],
        notes: 'La web de entradas carga con JavaScript: lista sacada del calendario oficial.',
      }),
    );
    const before = fake.messageRequests().length;
    const r = await ai.findEvents({ providerId: 'real-madrid', days: 45 });
    const reqs = fake.messageRequests().slice(before);
    assert.equal(reqs.length, 2, 'la vuelta pausada se reanuda con una segunda petición');
    const first = reqs[0]?.body ?? {};
    assert.equal(first.model, 'claude-opus-prueba-nuevo');
    assert.equal(first.stream, true, 'en streaming: una búsqueda larga no deja la conexión callada');
    assert.equal(first.fallbacks, 'default');
    assert.match(String(reqs[0]?.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
    assert.deepEqual(first.output_config, { effort: 'medium' });
    assert.equal(first.tool_choice, undefined, 'sin forzar la herramienta (el modelo lo rechaza)');
    const tools = first.tools as Array<Record<string, unknown>>;
    assert.deepEqual(
      tools.map((t) => t.type ?? t.name),
      ['web_search_20260209', 'web_fetch_20260209', 'entregar_eventos'],
    );
    assert.equal(tools[2]?.strict, true);
    assert.match(JSON.stringify(first.messages), /realmadrid\.com\/es-ES\/entradas/, 'Claude empieza por la web de venta');
    const resumed = reqs[1]?.body.messages as Array<{ role: string; content: Array<{ type: string }> }>;
    assert.equal(resumed.length, 2, 'sin mensajes extra al reanudar');
    assert.equal(resumed[1]?.role, 'assistant');
    assert.equal(resumed[1]?.content[0]?.type, 'server_tool_use');

    assert.deepEqual(
      r.events.map((e) => e.name),
      ['Real Madrid - Juventus', 'Real Madrid - FC Barcelona', 'Concierto en Vistalegre'],
      'por fecha y solo dentro de los días pedidos',
    );
    const [juve, barca, vista] = r.events;
    assert.equal(juve?.timeTBA, true);
    assert.equal(juve?.startsAtLocal, '2026-10-06T00:00');
    assert.equal(juve?.vaultVenueId, 'estadio-santiago-bernabeu', 'el alias «Bernabéu» es el recinto de la sala');
    assert.equal(barca?.startsAtLocal, '2026-10-25T16:15');
    assert.equal(barca?.saleOpensLocal, '2026-10-20T10:00');
    assert.equal(vista?.url, null, 'solo enlaces http(s)');
    assert.equal(vista?.saleOpensLocal, null);
    assert.equal(vista?.vaultVenueId, null);
    assert.match(r.notes, /calendario oficial/);
    // (3000 + 20000) × 4 $ + (300 + 1500) × 20 $ por millón, y 3 búsquedas × 0,01 $.
    assert.equal(r.cost.searches, 3);
    assert.equal(r.cost.fetches, 1);
    assert.ok(Math.abs(r.cost.usd - 0.158) < 1e-9, String(r.cost.usd));
    assert.ok(Math.abs(ai.status().spentUsd - 0.16) < 1e-9);

    const again = await ai.findEvents({ providerId: 'real-madrid', days: 45 });
    assert.equal(again.cached, true, 'la misma búsqueda al rato no cuesta nada');
    assert.equal(fake.messageRequests().length, before + 2);
  });

  it('lee el evento: el límite solo es «oficial» con la frase de la web de venta', async () => {
    fake.script.push(deliver('entregar_evento', detailsInput({ limitSource: 'https://www.realmadrid.com/es-ES/entradas/condiciones', planImage: PLAN })));
    const d = await ai.eventDetails({ providerId: 'real-madrid', name: BARCA.name, startsAtLocal: '2026-10-25T16:15', venue: BARCA.venue, city: 'Madrid', url: BARCA.url });
    const req = fake.messageRequests().at(-1);
    assert.deepEqual(req?.body.output_config, { effort: 'high' });
    // La estructura se analiza siempre, también con el recinto ya en la sala, y con nuestras zonas para hacerlas corresponder.
    assert.match(JSON.stringify(req?.body.messages), /Cómo está estructurada la venta de ESTE evento/);
    assert.match(JSON.stringify(req?.body.messages), /Nuestro plano de este recinto tiene estas zonas: Fondo Norte, Fondo Sur, Lateral Este, Lateral Oeste/);
    const tool = (req?.body.tools as Array<{ name: string; input_schema: { properties: { layout: { anyOf: Array<{ items?: { properties: { venueZone: { anyOf: Array<{ enum?: string[] }> } } } }> } } } }>).find(
      (t) => t.name === 'entregar_evento',
    );
    assert.deepEqual(tool?.input_schema.properties.layout.anyOf[0]?.items?.properties.venueZone.anyOf[0]?.enum, ['Fondo Norte', 'Fondo Sur', 'Lateral Este', 'Lateral Oeste']);
    assert.match(JSON.stringify(req?.body.messages), /condiciones de venta de ESTE evento/);
    assert.match(JSON.stringify(req?.body.messages), /Nunca una web de reventa/);
    assert.equal(d.seller, 'Real Madrid C. F.');
    assert.deepEqual(
      d.layout?.map((z) => [z.zone, z.venueZone, z.price]),
      [
        ['Lateral Este Grada Baja', 'Lateral Este', '120–250 €'],
        ['Fondo Sur Grada Alta', 'Fondo Sur', '60–90 €'],
        ['Zona VIP Castellana', null, null],
      ],
      'la zona de nuestro plano se normaliza y una inventada no vale',
    );
    assert.equal(d.limit.perPerson, 2);
    assert.equal(d.limit.official, true);
    assert.equal(d.limit.semantics, 'PER_HOLDER');
    assert.equal(d.vaultVenueId, 'estadio-santiago-bernabeu');
    assert.equal(d.planImageUrl, PLAN);
    assert.deepEqual(
      d.sales.map((x) => x.name),
      ['Venta socios', 'Venta general'],
      'fases por orden de apertura',
    );
    const draft = aiEventDraft(d, { today: '2026-10-01', nowLocal: '2026-10-01T10:00' });
    assert.equal(draft.onSaleAt, '2026-10-22T10:00', 'la venta general próxima es la apertura por defecto');
    assert.equal(draft.limit?.verified, true);
    assert.equal(draft.limit?.perAccount, 4, 'el límite de la fase elegida (venta general: 4)');
    const socios = aiEventDraft(d, { saleName: 'Venta socios', today: '2026-10-01', nowLocal: '2026-10-01T10:00' });
    assert.equal(socios.limit?.perAccount, 2, 'en la fase de socios, 2');
    assert.deepEqual(draft.saleZones, [
      'Lateral Este Grada Baja: Sector 101, Sector 102 · 120–250 € → Lateral Este',
      'Fondo Sur Grada Alta · 60–90 € → Fondo Sur',
      'Zona VIP Castellana: Palco 1',
    ]);
    assert.deepEqual(parseSaleZone(draft.saleZones[0] ?? ''), { zone: 'Lateral Este Grada Baja', sections: ['Sector 101', 'Sector 102'], standing: false, price: '120–250 €', venueZone: 'Lateral Este' });
    assert.match(draft.limit?.source ?? '', /Condiciones oficiales realmadrid\.com/);
    assert.match(draft.notes, /Fases de venta: Venta socios/);

    fake.script.push(deliver('entregar_evento', detailsInput({ name: 'Real Madrid - Juventus', limitSource: 'https://www.marca.com/futbol/entradas.html', planImage: 'https://127.0.0.1/plano.png' })));
    const n = await ai.eventDetails({ providerId: 'real-madrid', name: 'Real Madrid - Juventus', venue: 'Bernabéu' });
    assert.equal(n.limit.official, false, 'una noticia no vale como condiciones oficiales');
    assert.equal(n.planImageUrl, null, 'nunca una imagen en una dirección local');
    const nd = aiEventDraft(n, { today: '2026-10-01', nowLocal: '2026-10-01T10:00' });
    assert.equal(nd.limit?.verified, false);
    assert.match(nd.limit?.notes ?? '', /compruébalo/);

    // Un enlace de reventa nunca se usa como enlace oficial de compra.
    fake.script.push(deliver('entregar_evento', detailsInput({ name: 'Real Madrid - Inter', limitSource: 'https://www.realmadrid.com/x', planImage: null, url: 'https://www.viagogo.es/Entradas-Deportes/rm-inter' })));
    const v = await ai.eventDetails({ providerId: 'real-madrid', name: 'Real Madrid - Inter', venue: 'Bernabéu', url: 'https://www.realmadrid.com/es-ES/entradas/rm-inter' });
    assert.equal(v.url, 'https://www.realmadrid.com/es-ES/entradas/rm-inter', 'se queda el enlace oficial que ya había');
    assert.match(v.urlWarning ?? '', /reventa/);
  });

  it('sitúa las zonas sobre la imagen del plano oficial', async () => {
    const zones = ['Lateral Este', 'Lateral Oeste', 'Fondo Sur', 'Fondo Norte'];
    fake.script.push(
      deliver(
        'entregar_plano',
        {
          points: [
            { zone: 'Fondo Sur', x: 50, y: 92.34 },
            { zone: 'Lateral Este', x: 88, y: 50 },
            { zone: 'Inventada', x: 10, y: 10 },
            { zone: 'Fondo Norte', x: 150, y: 5 },
          ],
          notes: 'El lateral oeste no se ve bien.',
        },
        0,
        0,
      ),
    );
    const map = await ai.seatMap({ imageUrl: PLAN, zones, venue: 'Estadio Santiago Bernabéu' });
    assert.deepEqual(map.points, [
      { zone: 'Fondo Sur', x: 50, y: 92.3 },
      { zone: 'Lateral Este', x: 88, y: 50 },
    ]);
    const req = fake.messageRequests().at(-1);
    const content = (req?.body.messages as Array<{ content: Array<{ type: string; source?: { url: string } }> }>)[0]?.content ?? [];
    assert.equal(content[0]?.type, 'image');
    assert.equal(content[0]?.source?.url, PLAN, 'Claude mira la imagen por su enlace (este ordenador no la descarga)');
    const tools = req?.body.tools as Array<{ name: string; input_schema: { properties: { points: { items: { properties: { zone: { enum: string[] } } } } } } }>;
    assert.equal(tools.length, 1, 'sin búsquedas web');
    assert.deepEqual(tools[0]?.input_schema.properties.points.items.properties.zone.enum, zones);

    const svg = await ai.seatMap({ imageUrl: 'https://www.example.org/plano.svg', zones: ['Fondo Sur'] });
    assert.equal(svg.points.length, 0, 'un svg se enseña tal cual, sin analizarlo');
    assert.equal(svg.cost.usd, 0);
  });

  it('si Claude termina sin entregar, se le pide una vez; si lo rechaza, error claro', async () => {
    fake.script.push({ content: [{ type: 'text', text: 'He encontrado dos partidos.' }], stop_reason: 'end_turn' }, deliver('entregar_eventos', { events: [], notes: '' }));
    await ai.findEvents({ providerId: 'real-madrid', days: 11, fresh: true });
    const msgs = fake.messageRequests().at(-1)?.body.messages as Array<{ role: string; content: unknown }>;
    assert.equal(msgs.at(-1)?.role, 'user');
    assert.match(String(msgs.at(-1)?.content), /Entrega ahora/);

    fake.script.push({ content: [], stop_reason: 'refusal' });
    await assert.rejects(ai.findEvents({ providerId: 'real-madrid', days: 12, fresh: true }), (err: unknown) => err instanceof AiError && err.code === 'REFUSED');
  });

  it('por la API del dashboard: eventos, datos y errores claros', async () => {
    fake.script.push(deliver('entregar_eventos', { events: [BARCA], notes: '' }));
    const ok = await http.request('/api/ai/events', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ providerId: 'real-madrid', days: 30 }) });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as AiEventsResult).events.length, 1);
    const other = await http.request('/api/ai/events', { method: 'POST', headers: { ...JSON_HEADERS, origin: 'https://otra-web.example' }, body: JSON.stringify({ providerId: 'real-madrid', days: 20 }) });
    assert.equal(other.status, 403, 'cuesta dinero: solo desde el propio dashboard');
    const bad = await http.request('/api/ai/event', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ providerId: 'real-madrid' }) });
    assert.equal(bad.status, 400);
    const unknown = await http.request('/api/ai/events', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ providerId: 'no-existe', days: 5 }) });
    assert.equal(unknown.status, 400);
    assert.match(((await unknown.json()) as { error: { message: string } }).error.message, /no está en la sala/);
  });

  it('crea el evento con lo que ha leído Claude: recinto nuevo con sus zonas, vigilancia y plano', async () => {
    const d: AiEventDetails = {
      name: 'Concierto en Vistalegre',
      startsAtLocal: '2026-11-02T21:00',
      timeTBA: false,
      venue: 'Palacio Vistalegre',
      city: 'Madrid',
      url: 'https://www.vistalegre.example/concierto',
      seller: 'Auditorio de prueba',
      urlWarning: null,
      sales: [{ name: 'Venta general', opensAtLocal: '2026-10-05T10:00', limit: null }],
      limit: { perPerson: 6, semantics: 'PER_HOLDER', quote: 'Máximo 6 entradas por pedido', sourceUrl: 'https://www.noticias.example/x', official: false },
      price: { min: 35, max: 90, currency: 'EUR' },
      layout: [
        { zone: 'Pista', sections: [], standing: true, price: '45 €', venueZone: null },
        { zone: 'Grada Baja', sections: ['101', '102', '101'], standing: false, price: null, venueZone: null },
        { zone: 'Grada Alta', sections: ['201', '202'], standing: false, price: '35 €', venueZone: null },
      ],
      planImageUrl: 'https://www.vistalegre.example/plano.png',
      status: 'UPCOMING',
      notes: '',
      sources: ['https://www.vistalegre.example/'],
      vaultVenueId: null,
      cost: { usd: 0, searches: 0, fetches: 0, inputTokens: 0, outputTokens: 0, seconds: 0 },
      cached: false,
    };
    assert.equal(aiLayoutText(d.layout), 'Pista (de pie)\nGrada Baja: 101, 102\nGrada Alta: 201, 202');
    fake.script.push(deliver('entregar_plano', { points: [{ zone: 'Pista', x: 50, y: 70 }, { zone: 'Grada Baja', x: 50, y: 40 }], notes: '' }, 0, 0));
    const c = await assistant.create('manual', d, undefined, 'prueba');
    assert.equal(c.venue.created, true);
    assert.deepEqual([...c.venue.zones].sort(), ['Grada Alta', 'Grada Baja', 'Pista']);
    assert.equal(c.event.watchDaysBefore, 2, 'vigilado desde 2 días antes de la venta');
    assert.equal(Date.parse(c.event.onSaleAt ?? ''), Date.parse('2026-10-05T08:00:00Z'), '10:00 en Madrid');
    assert.equal(c.event.limits.perAccount, 6);
    assert.equal(c.event.limits.verified, false, 'sin frase de la web oficial, sin verificar');
    assert.equal(c.limitsVerified, false);
    assert.equal(c.planImage, 'https://www.vistalegre.example/plano.png');
    await c.planReady;
    const ev = app.runtime.store.events.get(c.event.id);
    assert.equal(ev?.seatMap?.image, 'https://www.vistalegre.example/plano.png');
    assert.deepEqual(
      ev?.seatMap?.points.map((p) => p.zone),
      ['Pista', 'Grada Baja'],
    );
    await assistant.setSeats(c.event.id, ['Grada Baja', 'Pista'], 'prueba');
    assert.deepEqual(app.runtime.store.events.get(c.event.id)?.preferredTargets, ['Grada Baja', 'Pista']);
    const text = await readFile(path.join(dir, c.file), 'utf8');
    assert.match(text, /Pista @ 50,70/, 'los puntos del plano se leen y se editan en Obsidian');
    assert.match(text, /Datos reunidos por Claude/);
  });

  it('Telegram /evento: web de venta → eventos → datos → crear → plano y 3 preferencias con color', async () => {
    const tg = new FakeTelegram();
    const tgBase = await tg.listen();
    const bot = new TelegramNotifier({ token: TOKEN, chatId: '700', apiBase: tgBase, retryMs: 50, setupProfile: false });
    app.runtime.ctx.notifier = bot;
    bot.attach(app.runtime);
    const tap = (id: string, data: string | undefined) =>
      tg.push({ callback_query: { id, data, from: { id: 700, username: 'levi' }, message: { chat: { id: 700, type: 'private' }, message_id: 99 } } });
    try {
      await until(() => bot.status().connected, 'bot conectado');
      tg.message(700, '/evento');
      await until(() => keyboardFor(tg, /Nuevo evento con Claude/).length > 0, 'menú de webs de venta');
      const seller = keyboardFor(tg, /Nuevo evento con Claude/).find((b) => /Real Madrid/.test(b.text));
      assert.ok(seller?.callback_data);
      assert.ok(!keyboardFor(tg, /Nuevo evento con Claude/).some((b) => /Simulador/.test(b.text)), 'las webs de ensayo no salen');

      // Claude tarda: mientras, el bot sigue respondiendo (p. ej. a una tarea de compra).
      fake.script.push({ ...deliver('entregar_eventos', { events: [BARCA], notes: '' }), delayMs: 400 });
      tap('cb1', seller.callback_data);
      await until(() => tg.sent.some((s) => s.method === 'editMessageText' && /Claude está mirando/.test(String(s.body.text))), 'aviso de búsqueda');
      tg.message(700, '/estado');
      await until(() => tg.messagesTo('700').some((t) => /operaciones activas|en carrito/.test(t)), 'respuesta a /estado');
      assert.ok(!tg.messagesTo('700').some((t) => /Próximos eventos/.test(t)), '/estado ha respondido antes de que Claude termine');
      await until(() => keyboardFor(tg, /Próximos eventos en Real Madrid/).length > 0, 'lista de eventos');
      const pick = keyboardFor(tg, /Próximos eventos en Real Madrid/).find((b) => /Barcelona/.test(b.text));
      assert.ok(pick?.callback_data);

      fake.script.push(deliver('entregar_evento', detailsInput({ limitSource: 'https://www.realmadrid.com/es-ES/entradas/condiciones', planImage: PLAN })));
      tap('cb2', pick.callback_data);
      await until(() => keyboardFor(tg, /Real Madrid - FC Barcelona/).some((b) => /Crear/.test(b.text)), 'datos del evento');
      const summary = tg.messagesTo('700').find((t) => /🎟/.test(t)) ?? '';
      assert.match(summary, /Límite: <b>2<\/b> por persona/);
      assert.match(summary, /de la web oficial ✓/);
      assert.match(summary, /Plano oficial encontrado/);
      const create = keyboardFor(tg, /Real Madrid - FC Barcelona/).find((b) => /Venta general/.test(b.text));
      assert.ok(create?.callback_data, 'se elige qué venta es la apertura');

      fake.script.push(deliver('entregar_plano', { points: [{ zone: 'Fondo Sur', x: 50, y: 92 }], notes: '' }, 0, 0));
      tap('cb3', create.callback_data);
      await until(() => tg.messagesTo('700').some((t) => /Evento creado/.test(t)), 'evento creado');
      await until(() => tg.sent.some((s) => s.method === 'sendPhoto' && s.body.photo === PLAN), 'imagen del plano oficial');
      await until(() => keyboardFor(tg, /Dónde queréis las entradas/).length > 0, 'elegir dónde');
      // La web vende una zona que el plano no tiene: se añade con un toque (y los nombres de la web, como alias).
      assert.ok(tg.messagesTo('700').some((t) => /La web vende también <b>Zona VIP Castellana<\/b>/.test(t)));
      const add = keyboardFor(tg, /Dónde queréis las entradas/).find((b) => /Añadir al recinto \(1 zona de la web\)/.test(b.text));
      assert.ok(add?.callback_data, 'botón para añadir la zona que falta');
      assert.ok(!keyboardFor(tg, /Dónde queréis las entradas/).some((b) => b.text === 'Zona VIP Castellana'));
      tap('a1', add.callback_data);
      await until(() => keyboardFor(tg, /Dónde queréis las entradas/).some((b) => b.text === 'Zona VIP Castellana'), 'zona añadida al plano');
      assert.ok(tg.sent.some((s) => s.method === 'answerCallbackQuery' && s.body.callback_query_id === 'a1' && /Añadida 1 zona/.test(String(s.body.text))));
      assert.ok(!keyboardFor(tg, /Dónde queréis las entradas/).some((b) => /Añadir al recinto/.test(b.text)), 'ya no falta ninguna');
      const bernabeu = [...app.runtime.store.artifacts.values()].find((x) => x.venueId === 'estadio-santiago-bernabeu' && x.eventId === null);
      assert.deepEqual(bernabeu?.zones.find((z) => z.name === 'Lateral Este')?.aliases, ['Lateral Este Grada Baja']);
      assert.deepEqual(bernabeu?.zones.find((z) => z.name === 'Fondo Sur')?.aliases, ['Fondo Sur Grada Alta']);
      assert.equal(bernabeu?.sections.find((x) => x.name === 'Palco 1')?.zoneId, bernabeu?.zones.find((z) => z.name === 'Zona VIP Castellana')?.id);
      const zones = keyboardFor(tg, /Dónde queréis las entradas/);
      const zone = (name: string) => zones.find((b) => b.text === name)?.callback_data;
      tap('z1', zone('Fondo Sur'));
      tap('z2', zone('Lateral Este'));
      tap('z3', zone('Fondo Norte'));
      tap('z4', zone('Lateral Oeste'));
      await until(() => tg.sent.filter((s) => s.method === 'answerCallbackQuery' && /^z\d$/.test(String(s.body.callback_query_id))).length === 4, 'respuestas a las zonas');
      const answers = tg.sent.filter((s) => s.method === 'answerCallbackQuery').map((s) => String(s.body.text ?? ''));
      assert.ok(answers.some((t) => /🟢 1ª preferencia: Fondo Sur/.test(t)));
      assert.ok(answers.some((t) => /Ya hay 3/.test(t)), 'como mucho 3 preferencias');
      assert.ok(keyboardFor(tg, /Dónde queréis las entradas/).some((b) => b.text === '🟠 2ª Lateral Este'), 'cada preferencia con su color');
      const done = keyboardFor(tg, /Dónde queréis las entradas/).find((b) => /Listo/.test(b.text));
      tap('k1', done?.callback_data);
      await until(() => tg.sent.some((s) => s.method === 'editMessageText' && /guardado/.test(String(s.body.text))), 'zonas guardadas');
      const ev = [...app.runtime.store.events.values()].find((e) => e.name === BARCA.name);
      assert.deepEqual(ev?.preferredTargets, ['Fondo Sur', 'Lateral Este', 'Fondo Norte']);
      assert.equal(ev?.venueId, 'estadio-santiago-bernabeu');
      assert.equal(ev?.limits.verified, true);
      await until(() => (app.runtime.store.events.get(ev?.id ?? '')?.seatMap?.points.length ?? 0) > 0, 'zonas situadas en el plano');
    } finally {
      bot.stop();
      app.runtime.ctx.notifier = null;
      await tg.close();
    }
  });

  it('si el modelo no admite el respaldo del servidor, se repite sin él', async () => {
    fake.script.push({ status: 400, type: 'invalid_request_error', message: 'fallbacks: "default" is not available for this model' }, deliver('entregar_eventos', { events: [], notes: '' }));
    const before = fake.messageRequests().length;
    const r = await ai.findEvents({ providerId: 'real-madrid', days: 10, fresh: true });
    const reqs = fake.messageRequests().slice(before);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0]?.body.fallbacks, 'default');
    assert.equal(reqs[1]?.body.fallbacks, undefined);
    assert.ok(!String(reqs[1]?.headers['anthropic-beta'] ?? '').includes('server-side-fallback'));
    assert.equal(r.events.length, 0);
  });
});
