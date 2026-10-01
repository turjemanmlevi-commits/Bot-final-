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
 * - «Buscar otra vez» renueva la caché, fases con el mismo nombre, y de qué
 *   webs vale la frase del límite (la del proveedor o la elegida por una persona).
 * - Gastar menos: caché de la API en las búsquedas web, respuestas guardadas en
 *   disco (gratis tras reiniciar), precio de cada modelo y elegir el modelo.
 * - Casos raros: errores 402/404/413 y 400 sin JSON crudo, probar otra clave,
 *   respuesta cortada por max_tokens o a mitad, API que se queda callada (tope
 *   propio), reventas y direcciones locales en los enlaces y precios imposibles.
 */

import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Hono } from 'hono';
import { AiDetailsQuerySchema, aiEventDraft, aiLayoutText, aiSaleZonesText, parseSaleZone, type AiEventDetails, type AiEventsResult, type AiKeyResult, type AiStatus } from '@to/shared';
import { createApp, type App } from '../app';
import { EventAssistant } from '../ai/assistant';
import { AiError, ClaudeControl, priceOf } from '../ai/claude';
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

  it('la clave buena se guarda en .env, se elige el Sonnet más reciente (lo más barato) y nunca se devuelve', async () => {
    const other = await http.request('/api/ai/key', { method: 'PUT', headers: { ...JSON_HEADERS, origin: 'https://otra-web.example' }, body: JSON.stringify({ key: AI_KEY }) });
    assert.equal(other.status, 403, 'otra web no puede poner la clave');
    const res = await http.request('/api/ai/key', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ key: AI_KEY }) });
    const r = (await res.json()) as AiKeyResult;
    assert.equal(r.ok, true, r.message);
    assert.match(await readFile(envFile, 'utf8'), new RegExp(`ANTHROPIC_API_KEY=${AI_KEY}`));
    assert.equal(r.status.model, 'Sonnet de prueba');
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
    assert.equal(first.model, 'claude-sonnet-prueba');
    assert.equal(first.stream, true, 'en streaming: una búsqueda larga no deja la conexión callada');
    assert.equal(first.fallbacks, 'default');
    assert.match(String(reqs[0]?.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
    assert.deepEqual(first.output_config, { effort: 'low' }, 'una lista: esfuerzo bajo');
    assert.equal(first.tool_choice, undefined, 'sin forzar la herramienta (el modelo lo rechaza)');
    const tools = first.tools as Array<Record<string, unknown>>;
    assert.deepEqual(
      tools.map((t) => t.type ?? t.name),
      ['web_search_20260209', 'web_fetch_20260209', 'entregar_eventos'],
    );
    assert.equal(tools[2]?.strict, true);
    assert.deepEqual(
      tools.slice(0, 2).map((t) => [t.max_uses, t.max_content_tokens]),
      [
        [4, undefined],
        [3, 15_000],
      ],
      'pocas búsquedas y lecturas, y páginas recortadas',
    );
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
    // Sonnet: (3000 + 20000) × 2 $ + (300 + 1500) × 10 $ por millón, y 3 búsquedas × 0,01 $.
    assert.equal(r.cost.searches, 3);
    assert.equal(r.cost.fetches, 1);
    assert.ok(Math.abs(r.cost.usd - 0.094) < 1e-9, String(r.cost.usd));
    assert.ok(Math.abs(ai.status().spentUsd - 0.09) < 1e-9);

    const again = await ai.findEvents({ providerId: 'real-madrid', days: 45 });
    assert.equal(again.cached, true, 'la misma búsqueda al rato no cuesta nada');
    assert.equal(fake.messageRequests().length, before + 2);
  });

  it('lee el evento: el límite solo es «oficial» con la frase de la web de venta', async () => {
    fake.script.push(deliver('entregar_evento', detailsInput({ limitSource: 'https://www.realmadrid.com/es-ES/entradas/condiciones', planImage: PLAN })));
    const d = await ai.eventDetails({ providerId: 'real-madrid', name: BARCA.name, startsAtLocal: '2026-10-25T16:15', venue: BARCA.venue, city: 'Madrid', url: BARCA.url });
    const req = fake.messageRequests().at(-1);
    assert.deepEqual(req?.body.output_config, { effort: 'medium' });
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
    assert.equal(draft.limit?.perAccount, 4, 'el límite de la fase elegida (venta general: 4)');
    assert.equal(draft.limit?.verified, false, 'la fase no trae fuente y da más que la frase oficial (2): hay que comprobarlo');
    assert.match(draft.limit?.source ?? '', /^Según realmadrid\.com/);
    assert.match(draft.limit?.notes ?? '', /frase oficial dice 2/);
    const socios = aiEventDraft(d, { saleName: 'Venta socios', today: '2026-10-01', nowLocal: '2026-10-01T10:00' });
    assert.equal(socios.limit?.perAccount, 2, 'en la fase de socios, 2');
    assert.equal(socios.limit?.verified, true, 'lo mismo que dice la frase oficial');
    assert.deepEqual(draft.saleZones, [
      'Lateral Este Grada Baja: Sector 101, Sector 102 · 120–250 € → Lateral Este',
      'Fondo Sur Grada Alta · 60–90 € → Fondo Sur',
      'Zona VIP Castellana: Palco 1',
    ]);
    assert.deepEqual(parseSaleZone(draft.saleZones[0] ?? ''), { zone: 'Lateral Este Grada Baja', sections: ['Sector 101', 'Sector 102'], standing: false, price: '120–250 €', venueZone: 'Lateral Este' });
    assert.match(socios.limit?.source ?? '', /Condiciones oficiales realmadrid\.com/);
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
      assert.equal(ev?.limits.verified, false, 'la venta general (4) da más que la frase oficial (2): hay que comprobarlo');
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

describe('Claude: caché, fases de venta y límite «oficial»', () => {
  let fake: FakeAnthropic;
  let dir = '';
  let app: App;
  let ai: ClaudeControl;

  before(async () => {
    setLogSilent(true);
    fake = new FakeAnthropic();
    const base = await fake.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-ai-cache-'));
    await writeAiVault(dir);
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    ai = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile: null, baseURL: base }, { apiKey: AI_KEY });
  });

  after(async () => {
    await app.stop();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    setLogSilent(false);
  });

  it('tras «Buscar otra vez», la respuesta nueva sustituye a la guardada (también para Telegram)', async () => {
    fake.script.push(deliver('entregar_eventos', { events: [{ ...BARCA, name: 'Lista vieja' }], notes: '' }));
    await ai.findEvents({ providerId: 'real-madrid', days: 30 });
    fake.script.push(deliver('entregar_eventos', { events: [{ ...BARCA, name: 'Lista nueva' }], notes: '' }));
    await ai.findEvents({ providerId: 'real-madrid', days: 30, fresh: true });
    const events = await ai.findEvents({ providerId: 'real-madrid', days: 30 });
    assert.deepEqual(
      events.events.map((e) => e.name),
      ['Lista nueva'],
    );
    assert.equal(events.cached, true);

    const opens = (at: string) => ({ ...detailsInput({ name: 'Real Madrid - Inter', limitSource: 'https://www.realmadrid.com/x', planImage: null }), sales: [{ name: 'Venta general', opensAt: at, limit: null }] });
    const q = { providerId: 'real-madrid', name: 'Real Madrid - Inter', venue: 'Bernabéu' };
    fake.script.push(deliver('entregar_evento', opens('2026-10-10T10:00')));
    await ai.eventDetails(q);
    fake.script.push(deliver('entregar_evento', opens('2026-10-12T12:00')));
    await ai.eventDetails({ ...q, fresh: true });
    assert.equal((await ai.eventDetails(q)).sales[0]?.opensAtLocal, '2026-10-12T12:00', 'la apertura nueva, no la de antes');

    const plan = { imageUrl: PLAN, zones: ['Fondo Sur'] };
    fake.script.push(deliver('entregar_plano', { points: [{ zone: 'Fondo Sur', x: 50, y: 10 }], notes: '' }, 0, 0));
    await ai.seatMap(plan);
    fake.script.push(deliver('entregar_plano', { points: [{ zone: 'Fondo Sur', x: 50, y: 90 }], notes: '' }, 0, 0));
    await ai.seatMap({ ...plan, fresh: true });
    assert.equal((await ai.seatMap(plan)).points[0]?.y, 90);
  });

  it('dos fases con el mismo nombre se distinguen (se elige la tocada) y las fechas imposibles no pasan', async () => {
    fake.script.push(
      deliver('entregar_evento', {
        ...detailsInput({ name: 'Final de Copa', limitSource: 'https://www.realmadrid.com/x', planImage: null }),
        sales: [
          { name: 'Venta general', opensAt: '2026-10-20T10:00', limit: 2 },
          { name: 'Venta general', opensAt: '2026-10-05T10:00', limit: 4 },
          { name: 'venta general', opensAt: '2026-10-20T10:00', limit: 2 },
          { name: 'Preventa', opensAt: '2026-02-30T10:00', limit: null },
          { name: 'Socios', opensAt: '2026-10-03T25:00', limit: null },
        ],
      }),
    );
    const d = await ai.eventDetails({ providerId: 'real-madrid', name: 'Final de Copa' });
    assert.deepEqual(
      d.sales.map((x) => x.name),
      ['Venta general', 'Venta general (20/10 10:00)', 'venta general (2)'],
    );
    // Telegram y el dashboard pasan el nombre de la fase tocada: la 2ª (20 de octubre, máx. 2).
    const draft = aiEventDraft(d, { saleName: d.sales[1]?.name ?? null, today: '2026-10-01', nowLocal: '2026-10-01T10:00' });
    assert.equal(draft.onSaleAt, '2026-10-20T10:00');
    assert.equal(draft.limit?.perAccount, 2);
  });

  it('el límite solo es «oficial» si la frase sale de la web del proveedor o del enlace elegido por una persona', async () => {
    const buy = 'https://www.eticketing.co.uk/chelseafc/EDP/Event/Index/1234';
    const chelsea = (limitSource: string) => ({ ...detailsInput({ name: 'Chelsea FC - Real Madrid', limitSource, planImage: null, url: buy }), venue: 'Stamford Bridge', city: 'London' });
    const q = { providerId: 'manual', name: 'Chelsea FC - Real Madrid', url: buy };
    // Sufijos de dos niveles: dailymail.co.uk no es eticketing.co.uk.
    fake.script.push(deliver('entregar_evento', chelsea('https://www.dailymail.co.uk/sport/football/article-1/chelsea-real-madrid-tickets.html')));
    assert.equal((await ai.eventDetails(q)).limit.official, false, 'un periódico .co.uk no es la web de venta');
    fake.script.push(deliver('entregar_evento', chelsea('https://help.eticketing.co.uk/chelseafc/terms')));
    assert.equal((await ai.eventDetails({ ...q, fresh: true })).limit.official, true, 'las condiciones de la web que eligió la persona');

    // El enlace que da el propio Claude no certifica su fuente (una noticia sigue siendo una noticia).
    const news = 'https://as.com/futbol/entradas-real-madrid-milan';
    fake.script.push(deliver('entregar_evento', detailsInput({ name: 'Real Madrid - Milan', limitSource: news, planImage: null, url: news })));
    const milan = await ai.eventDetails({ providerId: 'real-madrid', name: 'Real Madrid - Milan' });
    assert.equal(milan.url, news);
    assert.equal(milan.limit.official, false);
    // Sin web del proveedor ni enlace elegido no hay referencia fiable.
    const inter = 'https://www.inter.it/biglietti/inter-real-madrid';
    fake.script.push(deliver('entregar_evento', detailsInput({ name: 'Inter - Real Madrid', limitSource: inter, planImage: null, url: inter })));
    assert.equal((await ai.eventDetails({ providerId: 'manual', name: 'Inter - Real Madrid' })).limit.official, false);
  });
});

describe('Claude: errores de la API, cortes y enlaces raros', () => {
  let fake: FakeAnthropic;
  let base = '';
  let dir = '';
  let app: App;
  let ai: ClaudeControl;
  let http: Hono;

  before(async () => {
    setLogSilent(true);
    fake = new FakeAnthropic();
    base = await fake.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-ai-raros-'));
    await writeAiVault(dir);
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    ai = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile: null, baseURL: base }, { apiKey: AI_KEY });
    const authoring = new VaultAuthoring(app);
    app.runtime.ctx.eventAssistant = new EventAssistant(app, ai, authoring);
    http = createHttpApp(app, { dashboardDist: null, operatorToken: null, ai, authoring });
  });

  after(async () => {
    app.runtime.ctx.notifier = null;
    await app.stop();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    setLogSilent(false);
  });

  const failWith = async (status: number, type: string, message: string, days = 30) => {
    fake.script.push({ status, type, message });
    const res = await http.request('/api/ai/events', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ providerId: 'real-madrid', days, fresh: true }) });
    const body = (await res.json()) as { error: { code: string; message: string } };
    return { status: res.status, code: body.error.code, message: body.error.message };
  };

  it('402, 404 y 413 con su propio mensaje, un 400 sin el JSON de la API y, tras un 404 del modelo, se vuelve a elegir', async () => {
    const billing = await failWith(402, 'billing_error', 'Your credit balance is too low to access the Anthropic API.');
    assert.deepEqual([billing.status, billing.code], [502, 'AI_AUTH']);
    assert.match(billing.message, /no tiene saldo o hay un problema con el pago/);
    const big = await failWith(413, 'request_too_large', 'Request exceeds the maximum allowed number of bytes.');
    assert.deepEqual([big.status, big.code], [400, 'AI_BAD_REQUEST']);
    assert.match(big.message, /demasiado grande/);
    const bad = await failWith(400, 'invalid_request_error', 'messages: text content blocks must be non-empty');
    assert.equal(bad.message, 'Claude ha rechazado la consulta: messages: text content blocks must be non-empty');
    // Un 400 que habla de una «url» en una búsqueda sin imagen no es el plano.
    const fetchFailed = await failWith(400, 'invalid_request_error', 'tools.1.web_fetch: the url https://www.realmadrid.com could not be fetched');
    assert.doesNotMatch(fetchFailed.message, /imagen del plano/);
    const models = () => fake.requests.filter((r) => r.path === '/v1/models').length;
    const listed = models();
    const gone = await failWith(404, 'not_found_error', 'model: modelo-retirado');
    assert.deepEqual([gone.status, gone.code], [400, 'AI_BAD_REQUEST']);
    assert.match(gone.message, /ya no está disponible/);
    for (const e of [billing, big, bad, fetchFailed, gone]) {
      assert.doesNotMatch(e.message, /en un minuto/, 'reintentar no lo arregla');
      assert.doesNotMatch(e.message, /\{"type"|\b(402|404|413|400) \{/, 'sin el JSON crudo de la API');
    }
    fake.script.push(deliver('entregar_eventos', { events: [], notes: '' }));
    await ai.findEvents({ providerId: 'real-madrid', days: 31, fresh: true });
    assert.equal(models(), listed + 1, 'tras el 404 se mira otra vez la lista de modelos de la cuenta');
    // Con la imagen del plano, en cambio, sí se explica como el plano.
    fake.script.push({ status: 400, type: 'invalid_request_error', message: 'Unable to download the file. Please verify the URL and try again.' });
    await assert.rejects(ai.seatMap({ imageUrl: PLAN, zones: ['Fondo Sur'], fresh: true }), /imagen del plano/);
  });

  it('probar una clave que no vale no marca como rota la que se está usando', async () => {
    fake.script.push(deliver('entregar_eventos', { events: [], notes: '' }));
    await ai.findEvents({ providerId: 'real-madrid', days: 32, fresh: true });
    assert.equal(ai.status().ok, true);
    const r = await ai.setKey('sk-ant-api03-mala-0000000000000000000000', 'prueba');
    assert.equal(r.ok, false);
    assert.match(r.message, /no acepta la clave/);
    assert.equal(r.status.ok, true, 'la clave en uso sigue funcionando');
    assert.equal(ai.status().ok, true);
  });

  it('una respuesta cortada (por max_tokens o a mitad de la conexión) no se da por buena y se explica en castellano', async () => {
    fake.script.push({ ...deliver('entregar_eventos', { events: [BARCA], notes: '' }), stop_reason: 'max_tokens' });
    await assert.rejects(ai.findEvents({ providerId: 'real-madrid', days: 33, fresh: true }), (e: AiError) => e.code === 'INCOMPLETE' && /demasiado larga/.test(e.message));
    fake.script.push({ ...deliver('entregar_eventos', { events: [BARCA], notes: '' }), cut: true });
    await assert.rejects(
      ai.findEvents({ providerId: 'real-madrid', days: 34, fresh: true }),
      (e: AiError) => e.code === 'NETWORK' && /Se ha cortado la conexión con Claude/.test(e.message) && !/terminated/.test(e.message),
    );
  });

  it('si la API se queda callada, la búsqueda no se cuelga: tope propio y un mensaje claro', { timeout: 10_000 }, async () => {
    const slow = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile: null, baseURL: base, researchTimeoutMs: 400 }, { apiKey: AI_KEY });
    // Contesta y se calla (el tope del SDK solo cubre hasta las cabeceras) y, después, sin cabeceras.
    for (const reply of [{ ...deliver('entregar_eventos', { events: [], notes: '' }), stall: true }, { ...deliver('entregar_eventos', { events: [], notes: '' }), delayMs: 1500 }]) {
      fake.script.push(reply);
      const started = Date.now();
      await assert.rejects(slow.findEvents({ providerId: 'real-madrid', days: 35, fresh: true }), (e: AiError) => e.code === 'INCOMPLETE' && /tardando demasiado/.test(e.message));
      assert.ok(Date.now() - started < 2500, `${Date.now() - started} ms`);
    }
    // El tope del SDK (sin respuesta a tiempo) se reconoce por su clase: no es «revisa la conexión a internet».
    const explain = (slow as unknown as { explain(err: unknown): AiError }).explain.bind(slow);
    assert.match(explain(new Anthropic.APIConnectionTimeoutError()).message, /no ha contestado a tiempo/);
  });

  it('la lista de eventos no enseña reventas, direcciones locales ni enlaces cortados, ni fechas que no existen', async () => {
    const long = `${BARCA.url}?${'utm_x=1&'.repeat(130)}`;
    fake.script.push(
      deliver('entregar_eventos', {
        events: [
          { ...BARCA, name: 'Reventa', url: 'https://www.viagogo.es/Entradas-Deportes/rm-barcelona', sourceUrl: 'https://www.stubhub.es/rm' },
          { ...BARCA, name: 'Dirección local', url: 'http://127.0.0.1:8960/api/state', sourceUrl: 'https://intranet/entradas' },
          { ...BARCA, name: 'Localhost con punto', url: 'https://localhost./entradas', sourceUrl: 'https://club.localhost/entradas' },
          { ...BARCA, name: 'Enlace larguísimo', url: long },
          { ...BARCA, name: 'Fecha imposible', date: '2026-13-45', time: '21:00', saleOpens: '2026-99-99T99:99' },
          { ...BARCA, name: '30 de febrero', date: '2027-02-30', time: '25:00' },
          BARCA,
        ],
        notes: '',
      }),
    );
    const r = await ai.findEvents({ providerId: 'real-madrid', days: 365, fresh: true });
    const by = new Map(r.events.map((e) => [e.name, e]));
    for (const name of ['Reventa', 'Dirección local', 'Localhost con punto', 'Enlace larguísimo']) assert.equal(by.get(name)?.url, null, name);
    for (const name of ['Reventa', 'Dirección local', 'Localhost con punto']) assert.equal(by.get(name)?.sourceUrl, null, name);
    assert.equal(by.get(BARCA.name)?.url, BARCA.url, 'la web oficial, sí');
    assert.deepEqual([by.get('Fecha imposible')?.startsAtLocal, by.get('Fecha imposible')?.saleOpensLocal], [null, null]);
    assert.equal(by.get('30 de febrero')?.startsAtLocal, null);

    // Al leer el evento: la reventa no se le pide a Claude como «página del evento» y lo local no vale.
    fake.script.push(deliver('entregar_evento', detailsInput({ limitSource: 'http://192.168.1.10/condiciones', planImage: 'https://localhost./plano.png', url: 'http://10.0.0.5/compra' })));
    const d = await ai.eventDetails({ providerId: 'real-madrid', name: BARCA.name, url: 'https://www.viagogo.es/Entradas-Deportes/rm-barcelona', fresh: true });
    assert.doesNotMatch(JSON.stringify(fake.messageRequests().at(-1)?.body.messages), /viagogo/);
    assert.deepEqual([d.url, d.limit.sourceUrl, d.limit.official, d.planImageUrl], [null, null, false, null]);
    // Un plano en una dirección local no se manda a Claude (ni se paga).
    for (const imageUrl of ['https://localhost./p.png', 'https://estadio.localhost/p.png', 'https://intranet/p.png', 'https://nas.internal/p.png']) {
      const before = fake.messageRequests().length;
      await assert.rejects(async () => ai.seatMap({ imageUrl, zones: ['Fondo Sur'] }), /enlace https:\/\/ público/, imageUrl);
      assert.equal(fake.messageRequests().length, before, imageUrl);
    }
    // Grandes partidos: tampoco como «Web oficial de venta».
    const match = { home: 'Real Madrid', away: 'FC Barcelona', competition: 'LaLiga', category: 'CLASICO', importance: 99, why: 'x', date: '2026-10-25', time: '16:15', venue: 'Bernabéu', city: 'Madrid', country: 'España' };
    fake.script.push(
      deliver('entregar_partidos', {
        matches: [
          { ...match, ticketUrl: 'https://www.viagogo.es/clasico', saleOpens: '2026-10-20T25:61' },
          { ...match, date: '2026-11-25', ticketUrl: 'http://127.0.0.1/entradas', saleOpens: null },
        ],
        notes: '',
      }),
    );
    const t = await ai.topMatches({ focus: 'x', from: '2026-10-01', to: '2027-10-01', max: 10 });
    assert.deepEqual(
      t.matches.map((m) => [m.ticketUrl, m.saleOpensLocal]),
      [
        [null, null],
        [null, null],
      ],
    );
  });

  it('Telegram /evento con una web de venta sin enlace: contesta el motivo en vez de quedarse «buscando»', async () => {
    const tg = new FakeTelegram();
    const tgBase = await tg.listen();
    const bot = new TelegramNotifier({ token: TOKEN, chatId: '700', apiBase: tgBase, retryMs: 50, setupProfile: false });
    app.runtime.ctx.notifier = bot;
    bot.attach(app.runtime);
    try {
      await until(() => bot.status().connected, 'bot conectado');
      tg.message(700, '/evento');
      await until(() => keyboardFor(tg, /Nuevo evento con Claude/).length > 0, 'menú de webs de venta');
      const manual = keyboardFor(tg, /Nuevo evento con Claude/).find((b) => /Manual/.test(b.text));
      assert.ok(manual?.callback_data);
      tg.push({ callback_query: { id: 'm1', data: manual.callback_data, from: { id: 700, username: 'levi' }, message: { chat: { id: 700, type: 'private' }, message_id: 99 } } });
      await until(() => tg.messagesTo('700').some((t) => /❌ Falta la web de «Manual»/.test(t)), 'el motivo, en vez de «Claude sigue buscando…» para siempre');
      // Y la búsqueda no se queda ocupada: «Volver a empezar» y se puede elegir otra web.
      assert.ok(keyboardFor(tg, /Falta la web/).some((b) => /Volver a empezar/.test(b.text)));
    } finally {
      bot.stop();
      app.runtime.ctx.notifier = null;
      await tg.close();
    }
    // Lo mismo sin Telegram: el error llega como promesa rechazada, no de golpe.
    let pending: Promise<unknown> = Promise.resolve();
    assert.doesNotThrow(() => {
      pending = ai.seatMap({ imageUrl: 'https://127.0.0.1/p.png', zones: ['Fondo Sur'] });
    });
    await assert.rejects(pending, AiError);
  });

  it('precios: nunca negativos y, si el mínimo pasa del máximo, ninguno', async () => {
    const price = async (name: string, p: unknown) => {
      fake.script.push(deliver('entregar_evento', { ...detailsInput({ name, limitSource: 'https://www.realmadrid.com/x', planImage: null }), price: p }));
      return (await ai.eventDetails({ providerId: 'real-madrid', name, fresh: true })).price;
    };
    assert.deepEqual(await price('Precio negativo', { min: -10, max: 5, currency: 'EUR' }), { min: null, max: 5, currency: 'EUR' });
    assert.deepEqual(await price('Precios al revés', { min: 90, max: 60, currency: 'EUR' }), { min: null, max: null, currency: 'EUR' });
    assert.deepEqual(await price('Precios bien', { min: 60, max: 90, currency: 'eur' }), { min: 60, max: 90, currency: 'EUR' });
  });
});

describe('de lo que lee Claude a un evento de la sala', () => {
  const details = (p: Partial<AiEventDetails>): AiEventDetails => ({
    name: 'Real Madrid - FC Barcelona',
    startsAtLocal: '2026-10-25T16:15',
    timeTBA: false,
    venue: 'Estadio Santiago Bernabéu',
    city: 'Madrid',
    url: BARCA.url,
    seller: null,
    urlWarning: null,
    sales: [],
    limit: { perPerson: 4, semantics: 'PER_HOLDER', quote: 'Máximo 4 entradas por persona', sourceUrl: 'https://www.realmadrid.com/es-ES/entradas/condiciones', official: true },
    price: null,
    layout: null,
    planImageUrl: null,
    status: null,
    notes: '',
    sources: [],
    vaultVenueId: null,
    cost: { usd: 0, searches: 0, fetches: 0, inputTokens: 0, outputTokens: 0, seconds: 0 },
    cached: false,
    ...p,
  });
  const opts = { today: '2026-10-01', nowLocal: '2026-10-01T10:00' };

  it('una fase sin fuente propia nunca queda verificada por encima de la frase oficial', () => {
    const above = aiEventDraft(details({ sales: [{ name: 'Venta general', opensAtLocal: '2026-10-22T10:00', limit: 6 }] }), opts);
    assert.equal(above.limit?.perAccount, 6);
    assert.equal(above.limit?.verified, false);
    assert.match(above.limit?.source ?? '', /^Según realmadrid\.com .*6 por persona en «Venta general»/);
    assert.match(above.limit?.notes ?? '', /«Venta general» da 6 por persona y la frase oficial dice 4/);
    const below = aiEventDraft(details({ sales: [{ name: 'Venta socios', opensAtLocal: '2026-10-22T10:00', limit: 2 }] }), opts);
    assert.deepEqual([below.limit?.perAccount, below.limit?.verified], [2, true], 'por debajo de lo oficial, sí');
    const same = aiEventDraft(details({ sales: [{ name: 'Venta general', opensAtLocal: '2026-10-22T10:00', limit: null }] }), opts);
    assert.deepEqual([same.limit?.perAccount, same.limit?.verified], [4, true]);
  });

  it('la estructura de la venta va y vuelve igual aunque los nombres lleven « · » (como las secciones del vault)', () => {
    const layout = [{ zone: 'Shed End', sections: ['Shed End · Grada alta', 'Shed End · Grada baja'], standing: false, price: '60–90 £', venueZone: 'Shed End' }];
    const line = aiSaleZonesText(layout)[0] ?? '';
    assert.deepEqual(parseSaleZone(line), { zone: 'Shed End', sections: ['Shed End - Grada alta', 'Shed End - Grada baja'], standing: false, price: '60–90 £', venueZone: 'Shed End' });
  });

  it('un enlace largo de la lista de Claude se puede abrir en el dashboard', () => {
    const url = `${BARCA.url}?${'utm_x=1&'.repeat(70)}`;
    assert.ok(url.length > 600 && url.length <= 1000);
    assert.equal(AiDetailsQuerySchema.safeParse({ providerId: 'real-madrid', name: BARCA.name, url }).success, true);
  });
});

describe('Claude: gastar menos (caché de la API, respuestas guardadas y modelo)', () => {
  let fake: FakeAnthropic;
  let dir = '';
  let envDir = '';
  let envFile = '';
  let cacheFile = '';
  let base = '';
  let app: App;
  let ai: ClaudeControl;
  let http: Hono;

  before(async () => {
    setLogSilent(true);
    fake = new FakeAnthropic();
    base = await fake.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-ai-cost-'));
    await writeAiVault(dir);
    envDir = await mkdtemp(path.join(tmpdir(), 'to-ai-cost-env-'));
    envFile = path.join(envDir, '.env');
    cacheFile = path.join(envDir, 'datos', 'claude-respuestas.json');
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    ai = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile, baseURL: base, cacheFile }, { apiKey: AI_KEY });
    await ai.load();
    http = createHttpApp(app, { dashboardDist: null, operatorToken: null, ai });
  });

  after(async () => {
    await app.stop();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    await rm(envDir, { recursive: true, force: true });
    setLogSilent(false);
  });

  it('con búsqueda web se usa la caché de la API y lo leído de ella se cobra barato; el plano (una vuelta) no la usa', async () => {
    fake.script.push({
      ...deliver('entregar_eventos', { events: [BARCA], notes: '' }),
      usage: { input_tokens: 2000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 10_000, output_tokens: 1000, server_tool_use: { web_search_requests: 2 } },
    });
    const r = await ai.findEvents({ providerId: 'real-madrid', days: 30 });
    const body = fake.messageRequests().at(-1)?.body ?? {};
    assert.deepEqual(body.cache_control, { type: 'ephemeral' }, 'caché automática de lo que va leyendo');
    const system = body.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    assert.ok(Array.isArray(system), 'instrucciones con su marca de caché');
    assert.match(system.at(-1)?.text ?? '', /investigador de eventos/);
    assert.deepEqual(system.at(-1)?.cache_control, { type: 'ephemeral' });
    // Sonnet: (2000 × 2 + 1000 × 10 + 50 000 × 0,2 + 10 000 × 2,5) $ por millón + 2 búsquedas × 0,01 $.
    assert.ok(Math.abs(r.cost.usd - 0.069) < 1e-9, String(r.cost.usd));
    assert.equal(r.cost.inputTokens, 62_000, 'los tokens leídos incluyen los de la caché');

    fake.script.push(deliver('entregar_plano', { points: [{ zone: 'Fondo Sur', x: 50, y: 90 }], notes: '' }, 0, 0));
    await ai.seatMap({ imageUrl: PLAN, zones: ['Fondo Sur'] });
    const plan = fake.messageRequests().at(-1)?.body ?? {};
    assert.equal(plan.cache_control, undefined, 'una sola vuelta: la caché solo encarecería');
    assert.equal(typeof plan.system, 'string');
  });

  it('las respuestas se guardan en disco: tras reiniciar, la misma búsqueda es gratis y «Buscar otra vez» pregunta de nuevo', async () => {
    fake.script.push(deliver('entregar_evento', detailsInput({ limitSource: 'https://www.realmadrid.com/es-ES/entradas/condiciones', planImage: PLAN })));
    const q = { providerId: 'real-madrid', name: BARCA.name, startsAtLocal: '2026-10-25T16:15', venue: BARCA.venue, city: 'Madrid', url: BARCA.url };
    const first = await ai.eventDetails(q);
    assert.equal(first.cached, false);
    await ai.flushed();
    assert.ok(existsSync(cacheFile), 'se guarda junto a los datos');

    // «Reiniciar»: otra sala de control con el mismo archivo.
    const again = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile: null, baseURL: base, cacheFile }, { apiKey: AI_KEY });
    await again.load();
    const before = fake.messageRequests().length;
    const list = await again.findEvents({ providerId: 'real-madrid', days: 30 });
    assert.equal(list.cached, true);
    assert.deepEqual(list.events.map((e) => e.name), [BARCA.name]);
    const d = await again.eventDetails(q);
    assert.equal(d.cached, true);
    assert.equal(d.limit.perPerson, 2);
    assert.equal(fake.messageRequests().length, before, 'sin preguntar a Claude');

    // Un archivo roto no impide arrancar: se vuelve a preguntar.
    await writeFile(cacheFile, '{ roto', 'utf8');
    const broken = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile: null, baseURL: base, cacheFile }, { apiKey: AI_KEY });
    await broken.load();
    fake.script.push(deliver('entregar_eventos', { events: [], notes: '' }));
    assert.equal((await broken.findEvents({ providerId: 'real-madrid', days: 30 })).cached, false);
    // Las otras salas de la prueba ya no cuentan: el estado vuelve a ser el de la primera.
    app.runtime.ctx.aiStatus = () => ai.status();

    fake.script.push(deliver('entregar_evento', detailsInput({ name: 'Otra lectura', limitSource: 'https://www.realmadrid.com/x', planImage: null })));
    const fresh = await ai.eventDetails({ ...q, fresh: true });
    assert.equal(fresh.cached, false);
    assert.equal(fresh.name, 'Otra lectura');
    assert.equal(fake.messageRequests().length, before + 2);
  });

  it('se puede elegir el modelo: la lista trae su precio, Opus cuesta el doble y se guarda en .env', async () => {
    const list = await ai.models();
    assert.deepEqual(
      list.options.map((o) => [o.id, o.input, o.output]),
      [
        ['claude-sonnet-prueba', 2, 10],
        ['claude-opus-prueba-nuevo', 4, 20],
        ['claude-opus-prueba-viejo', 4, 20],
      ],
      'Opus y Sonnet con búsqueda web, del más nuevo al más viejo (ni Haiku ni Opus 4.5)',
    );
    assert.equal(list.current, 'claude-sonnet-prueba', 'por defecto, el más barato');
    assert.equal(list.fixed, false);

    const other = await http.request('/api/ai/model', { method: 'PUT', headers: { ...JSON_HEADERS, origin: 'https://otra-web.example' }, body: JSON.stringify({ model: 'claude-opus-prueba-nuevo' }) });
    assert.equal(other.status, 403, 'otra web no puede cambiarlo');
    const bad = (await (await http.request('/api/ai/model', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001' }) })).json()) as AiKeyResult;
    assert.equal(bad.ok, false);
    assert.match(bad.message, /no sirve para buscar en la web/);

    const res = await http.request('/api/ai/model', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ model: 'claude-opus-prueba-nuevo' }) });
    const r = (await res.json()) as AiKeyResult;
    assert.equal(r.ok, true, r.message);
    assert.equal(r.status.modelId, 'claude-opus-prueba-nuevo');
    assert.equal(r.status.modelFixed, true);
    assert.equal(r.status.model, 'Opus de prueba (nuevo)');
    assert.match(await readFile(envFile, 'utf8'), /ANTHROPIC_MODEL=claude-opus-prueba-nuevo/);

    fake.script.push({ ...deliver('entregar_eventos', { events: [], notes: '' }), usage: { input_tokens: 10_000, output_tokens: 1000, server_tool_use: { web_search_requests: 2 } } });
    const s = await ai.findEvents({ providerId: 'real-madrid', days: 30, fresh: true });
    assert.equal(fake.messageRequests().at(-1)?.body.model, 'claude-opus-prueba-nuevo');
    // Opus: (10 000 × 4 + 1000 × 20) $ por millón + 2 búsquedas × 0,01 $.
    assert.ok(Math.abs(s.cost.usd - 0.08) < 1e-9, String(s.cost.usd));

    const auto = (await (await http.request('/api/ai/model', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ model: null }) })).json()) as AiKeyResult;
    assert.equal(auto.ok, true, auto.message);
    assert.equal(auto.status.modelId, 'claude-sonnet-prueba', 'automático: el Sonnet más reciente');
    assert.equal(auto.status.modelFixed, false);
    assert.doesNotMatch(await readFile(envFile, 'utf8'), /ANTHROPIC_MODEL=claude/);
  });

  it('precio orientativo de cada modelo', () => {
    assert.equal(priceOf('claude-opus-5-5').input, 4);
    assert.equal(priceOf('claude-opus-4-8').input, 5);
    assert.equal(priceOf('claude-sonnet-5-5').input, 2);
    assert.equal(priceOf('claude-sonnet-5-5').cacheRead, 0.2);
    assert.equal(priceOf('claude-sonnet-4-6').output, 15);
    assert.equal(priceOf('claude-haiku-4-5').input, 1);
    assert.equal(priceOf('un-modelo-nuevo').input, 4, 'si no se conoce, como Opus (por lo alto)');
  });
});
