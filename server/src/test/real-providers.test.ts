/**
 * Proveedores reales en asistencia manual (Ticketmaster, entradas.com, Real
 * Madrid), alta de eventos y recintos desde el dashboard y flujo completo de
 * una compra coordinada por la API, con una copia del vault real.
 */

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
  Account,
  AiSaleZone,
  Cart,
  EventNoteInput,
  EventNoteResult,
  HumanTask,
  OperationConfig,
  OperationDetail,
  SystemStatus,
  VaultCompileReport,
  VenueQuickResult,
} from '@to/shared';
import { aiSaleZonesText, parseVenueLayout } from '@to/shared';
import type { Hono } from 'hono';
import { createApp, type App } from '../app';
import { createHttpApp } from '../http/app';
import { MemoryDriver } from '../store/drivers';
import { VirtualClock } from '../util/clock';
import { SeqIdGen } from '../util/ids';
import { setLogSilent } from '../util/log';
import { iso } from '../util/time';
import { compileVault } from '../vault/compiler';

const VAULT = path.resolve(fileURLToPath(new URL('../../../vault', import.meta.url)));
const START = Date.parse('2026-09-28T16:00:00Z');

describe('vault real', () => {
  it('tiene los 20 estadios de LaLiga 2026-27, pabellones y recintos de festivales, sin avisos', async () => {
    const c = await compileVault({ vaultDir: VAULT, timeZone: 'Europe/Madrid' });
    assert.deepEqual(c.report.errors, []);
    assert.deepEqual(c.report.warnings, []);
    const ids = new Set(c.report.venues.map((v) => v.venueId));
    for (const id of [
      'estadio-santiago-bernabeu', 'riyadh-air-metropolitano', 'spotify-camp-nou', 'san-mames', 'reale-arena', 'estadio-de-la-cartuja',
      'estadio-ramon-sanchez-pizjuan', 'estadio-de-mestalla', 'estadio-de-la-ceramica', 'estadi-ciutat-de-valencia', 'estadio-de-mendizorroza',
      'abanca-balaidos', 'abanca-riazor', 'estadio-manuel-martinez-valero', 'rcde-stadium', 'coliseum-getafe', 'estadio-la-rosaleda',
      'estadio-el-sadar', 'estadio-el-sardinero', 'estadio-de-vallecas',
      'movistar-arena', 'palau-sant-jordi', 'roig-arena', 'plaza-de-toros-de-las-ventas', 'campus-de-cantoblanco-uam', 'espacio-iberdrola-music',
    ]) {
      assert.ok(ids.has(id), `falta el recinto ${id}`);
    }
    for (const v of c.report.venues) assert.ok(v.sections > 0, `${v.name} sin secciones`);
    // Los nombres de las ticketeras se resuelven: «Lateral Oeste Grada baja» → su sección.
    const metro = c.artifacts.find((a) => a.venueId === 'riyadh-air-metropolitano' && a.eventId === null);
    assert.ok(metro?.sections.some((s) => s.name === 'Lateral Oeste · Grada baja'));
  });

  it('compila sin errores con Ticketmaster, entradas.com, Real Madrid y el Bernabéu', async () => {
    const c = await compileVault({ vaultDir: VAULT, timeZone: 'Europe/Madrid' });
    assert.deepEqual(c.report.errors, []);
    for (const [id, url] of [
      ['ticketmaster', 'https://www.ticketmaster.es/'],
      ['entradas-com', 'https://www.entradas.com/'],
      ['real-madrid', 'https://www.realmadrid.com/es-ES/entradas'],
    ] as const) {
      const p = c.providers.find((x) => x.providerId === id);
      assert.ok(p, `falta el proveedor ${id}`);
      assert.equal(p?.mode, 'MANUAL_ASSIST');
      assert.deepEqual(p?.authorized, [], `${id} no autoriza nada automático`);
      assert.equal(p?.url, url);
    }
    const bernabeu = c.report.venues.find((v) => v.venueId === 'estadio-santiago-bernabeu');
    assert.equal(bernabeu?.zones, 4);
    assert.equal(bernabeu?.sections, 20);
  });
});

describe('recinto rápido', () => {
  it('interpreta zonas, secciones y «de pie», y desambigua nombres repetidos', () => {
    const r = parseVenueLayout('Lateral Este: Grada baja, Primer anfiteatro\nFondo Sur: Grada baja\n- Pista (de pie)\n\n# comentario');
    assert.deepEqual(r.errors, []);
    assert.deepEqual(
      r.zones.map((z) => [z.name, z.standing, z.sections.map((s) => s.name)]),
      [
        ['Lateral Este', false, ['Lateral Este · Grada baja', 'Primer anfiteatro']],
        ['Fondo Sur', false, ['Fondo Sur · Grada baja']],
        ['Pista', true, ['Pista']],
      ],
    );
    assert.ok(parseVenueLayout('A\na').errors.some((e) => e.includes('repetida')));
    assert.ok(parseVenueLayout('   ').errors.length > 0);
  });
});

describe('compra real coordinada (API + asistencia manual)', () => {
  let dir = '';
  let app: App;
  let http: Hono;
  let clock: VirtualClock;

  const call = async <T>(method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> => {
    const res = await http.request(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-actor': encodeURIComponent('Leviç') },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
  };

  before(async () => {
    setLogSilent(true);
    dir = await mkdtemp(path.join(tmpdir(), 'to-real-'));
    await cp(VAULT, dir, { recursive: true });
    clock = new VirtualClock(START);
    app = await createApp({
      driver: new MemoryDriver(),
      vaultDir: dir,
      timeZone: 'Europe/Madrid',
      publicBaseUrl: 'http://localhost:8787',
      clock,
      ids: new SeqIdGen(),
      cfg: { humanTaskDeadlineMs: 10 * 60_000 },
    });
    http = createHttpApp(app, { dashboardDist: null, operatorToken: null });
  });

  after(async () => {
    await app.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const rmEvent: EventNoteInput = {
    name: 'Real Madrid - Rival de prueba',
    venueId: 'estadio-santiago-bernabeu',
    providerId: 'real-madrid',
    url: 'https://www.realmadrid.com/es-ES/futbol/partidos/entradas/real-madrid-prueba',
    startsAt: '2026-10-04T21:00',
    onSaleAt: '2026-09-28T18:05',
    currency: 'EUR',
    limitPerAccount: 2,
    limitPerGroup: 2,
    limitPerOperation: 4,
    limitSemantics: 'PER_HOLDER',
    limitsVerified: true,
    limitsSource: 'https://www.realmadrid.com/es-ES/entradas (condiciones de la fase)',
    notes: 'Fase de socios.',
  };

  it('los proveedores reales aparecen en el sistema como asistencia manual', async () => {
    const { json } = await call<SystemStatus>('GET', '/api/system');
    for (const id of ['ticketmaster', 'entradas-com', 'real-madrid']) {
      const p = json.providers.find((x) => x.id === id);
      assert.equal(p?.mode, 'MANUAL_ASSIST', id);
      assert.ok(p?.capabilities.every((cap) => cap.executor !== 'AUTOMATED'), `${id}: nada automático`);
    }
  });

  it('valida las cuentas: alias sí, emails, teléfonos o chat IDs raros no', async () => {
    const bad = await call('POST', '/api/accounts', { label: 'X', providerId: 'real-madrid', holderRef: 'levi@gmail.com' });
    assert.equal(bad.status, 400);
    const phone = await call('POST', '/api/accounts', { label: 'X', providerId: 'real-madrid', holderRef: '612 345 678' });
    assert.equal(phone.status, 400);
    const chat = await call('POST', '/api/accounts', { label: 'X', providerId: 'real-madrid', holderRef: 'x', telegramChatId: 'mi-chat' });
    assert.equal(chat.status, 400);
    const unknown = await call('POST', '/api/accounts', { label: 'X', providerId: 'no-existe', holderRef: 'x' });
    assert.equal(unknown.status, 409);
    for (const p of ['ticketmaster', 'entradas-com', 'real-madrid']) {
      const ok = await call<Account>('POST', '/api/accounts', { label: `Prueba ${p}`, providerId: p, holderRef: 'prueba', verification: 'VERIFIED', telegramChatId: '-1001234567890' });
      assert.equal(ok.status, 201, p);
      assert.equal(ok.json.providerId, p);
    }
  });

  it('crea el evento como nota del vault y lo compila', async () => {
    const { status, json } = await call<EventNoteResult>('POST', '/api/vault/events', rmEvent);
    assert.equal(status, 201, JSON.stringify(json));
    assert.equal(json.file, '20 Eventos/Real Madrid - Rival de prueba.md');
    assert.deepEqual(json.issues.filter((i) => i.severity === 'ERROR'), []);
    assert.equal(json.event?.id, 'evt-real-madrid-rival-de-prueba');
    assert.equal(json.event?.url, rmEvent.url);
    assert.equal(json.event?.providerId, 'real-madrid');
    assert.equal(json.event?.onSaleAt, '2026-09-28T16:05:00.000Z', 'hora de Madrid');
    assert.equal(json.event?.limits.verified, true);
    assert.equal(json.event?.limits.verifiedBy, 'Leviç');
    const text = await readFile(path.join(dir, json.file), 'utf8');
    assert.match(text, /provider: "\[\[Real Madrid\]\]"/);
    assert.match(text, /venue: "\[\[Estadio Santiago Bernabéu\]\]"/);
    const again = await call('POST', '/api/vault/events', rmEvent);
    assert.equal(again.status, 409, 'no pisa una nota existente');
  });

  it('edita el evento sin perder el resto de la nota', async () => {
    const id = 'evt-real-madrid-rival-de-prueba';
    const { status, json } = await call<EventNoteResult>('PUT', `/api/vault/events/${id}`, { ...rmEvent, name: 'Real Madrid - Rival (editado)', limitPerOperation: 6 });
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.event?.id, id, 'el id no cambia al renombrar');
    assert.equal(json.event?.name, 'Real Madrid - Rival (editado)');
    assert.equal(json.event?.limits.perOperation, 6);
    const text = await readFile(path.join(dir, json.file), 'utf8');
    assert.match(text, /Fase de socios\./, 'el cuerpo se conserva');
    assert.match(text, /tags:\n\s+- evento/, 'las demás propiedades se conservan');
  });

  it('crea un recinto rápido y un evento de Ticketmaster en él', async () => {
    const venue = await call<VenueQuickResult>('POST', '/api/vault/venues', {
      name: 'Recinto de Prueba Madrid',
      city: 'Madrid',
      source: 'Plano oficial del evento (prueba)',
      layout: 'Pista (de pie)\nGrada Baja: 101, 102\nGrada Alta: 201, 202',
    });
    assert.equal(venue.status, 201, JSON.stringify(venue.json));
    assert.equal(venue.json.venueId, 'recinto-de-prueba-madrid');
    assert.equal(venue.json.files, 1 + 3 + 5);
    assert.deepEqual(venue.json.issues.filter((i) => i.severity === 'ERROR'), []);
    const dup = await call('POST', '/api/vault/venues', { name: 'Recinto de prueba madrid', source: 'x x x', layout: 'A' });
    assert.equal(dup.status, 409);
    const ev = await call<EventNoteResult>('POST', '/api/vault/events', {
      ...rmEvent,
      name: 'Concierto de prueba',
      venueId: 'recinto-de-prueba-madrid',
      providerId: 'ticketmaster',
      url: 'https://www.ticketmaster.es/event/prueba',
    });
    assert.equal(ev.status, 201, JSON.stringify(ev.json));
    assert.equal(ev.json.event?.venueId, 'recinto-de-prueba-madrid');
  });

  it('guarda la estructura de la venta en el evento y completa el recinto (zonas nuevas y alias, sin duplicar)', async () => {
    const venueId = 'recinto-de-prueba-madrid';
    // Como la da Claude: una zona que ya está, una que la web llama distinto (→ alias) y dos que faltan.
    const zones: AiSaleZone[] = [
      { zone: 'Grada Baja', sections: ['101', '102'], standing: false, price: '60–90 €', venueZone: 'Grada Baja' },
      { zone: 'Tribuna Alta', sections: ['201', '202'], standing: false, price: '40 €', venueZone: 'Grada Alta' },
      { zone: 'Palcos VIP', sections: ['P1', 'P2'], standing: false, price: null, venueZone: null },
      { zone: 'Front Stage', sections: [], standing: true, price: '120 €', venueZone: null },
    ];
    const ev = await call<EventNoteResult>('POST', '/api/vault/events', {
      ...rmEvent,
      name: 'Concierto con estructura',
      venueId,
      providerId: 'ticketmaster',
      url: 'https://www.ticketmaster.es/event/estructura',
      saleZones: aiSaleZonesText(zones),
    });
    assert.equal(ev.status, 201, JSON.stringify(ev.json));
    assert.deepEqual(ev.json.event?.saleZones, zones, 'la estructura va y vuelve igual por la nota del evento');
    const text = await readFile(path.join(dir, ev.json.file), 'utf8');
    assert.match(text, /saleZones:\n\s+- "?Grada Baja: 101, 102 · 60–90 € → Grada Baja"?/);

    const artifact = () => [...app.runtime.store.artifacts.values()].find((a) => a.venueId === venueId && a.eventId === null);
    const before = artifact();
    assert.deepEqual(before?.zones.map((z) => z.name).sort(), ['Grada Alta', 'Grada Baja', 'Pista']);

    type Added = { zones: number; aliases: number; report: VaultCompileReport };
    const add = await call<Added>('POST', `/api/vault/venues/${venueId}/sale-zones`, { zones });
    assert.equal(add.status, 200, JSON.stringify(add.json));
    assert.equal(add.json.zones, 2, 'Palcos VIP y Front Stage');
    assert.equal(add.json.aliases, 1, 'Tribuna Alta → Grada Alta');
    assert.equal(add.json.report.ok, true);
    const after = artifact();
    assert.deepEqual(after?.zones.map((z) => z.name).sort(), ['Front Stage', 'Grada Alta', 'Grada Baja', 'Palcos VIP', 'Pista']);
    assert.deepEqual(after?.zones.find((z) => z.name === 'Grada Alta')?.aliases, ['Tribuna Alta']);
    const zoneOf = (section: string) => after?.zones.find((z) => z.id === after.sections.find((x) => x.name === section)?.zoneId)?.name;
    assert.equal(zoneOf('P1'), 'Palcos VIP');
    assert.equal(zoneOf('P2'), 'Palcos VIP');
    assert.equal(after?.sections.find((x) => x.name === 'Front Stage')?.kind, 'STANDING');
    assert.deepEqual(after?.warnings.filter((w) => /ambiguo/i.test(w)), [], 'ningún alias apunta a dos zonas');

    // Repetirlo no duplica nada, y una zona que ya es alias de otra (aunque Claude no la asocie) tampoco se crea.
    const again = await call<Added>('POST', `/api/vault/venues/${venueId}/sale-zones`, { zones });
    assert.deepEqual([again.json.zones, again.json.aliases], [0, 0]);
    const byAlias = await call<Added>('POST', `/api/vault/venues/${venueId}/sale-zones`, {
      zones: [{ zone: 'tribuna  alta', sections: [], standing: false, price: null, venueZone: null }],
    });
    assert.deepEqual([byAlias.json.zones, byAlias.json.aliases], [0, 0]);
    assert.equal(artifact()?.zones.length, 5);

    const missing = await call('POST', '/api/vault/venues/no-existe/sale-zones', { zones });
    assert.equal(missing.status, 404);
    const empty = await call('POST', `/api/vault/venues/${venueId}/sale-zones`, { zones: [] });
    assert.equal(empty.status, 400);
  });

  it('coordina la compra: sesión, tarea con enlace oficial, carrito y pago humano', async () => {
    const eventId = 'evt-real-madrid-rival-de-prueba';
    const ana = await call<Account>('POST', '/api/accounts', { label: 'Ana (socia)', providerId: 'real-madrid', holderRef: 'ana', verification: 'VERIFIED' });
    const bea = await call<Account>('POST', '/api/accounts', { label: 'Bea (socia)', providerId: 'real-madrid', holderRef: 'bea', verification: 'VERIFIED' });
    const t0 = Date.parse('2026-09-28T16:05:00Z');
    const config: OperationConfig = {
      name: 'Partido de prueba',
      eventId,
      providerId: 'real-madrid',
      t0: iso(t0),
      runWindowMinutes: 60,
      freezeLeadSeconds: 30,
      requestedQty: 4,
      currency: 'EUR',
      maxUnitPrice: 12_000,
      budget: 48_000,
      preferences: {
        targets: ['Lateral Este · Primer anfiteatro', 'Fondo Sur'],
        excludeSections: [],
        requireContiguous: true,
        minGroupSize: 1,
        allowStanding: false,
        allowObstructed: false,
        allowAccessible: false,
        maxAmbiguity: 0.2,
      },
      accountIds: [ana.json.id, bea.json.id],
      cartExpiryAlertsSeconds: [300, 60],
    };
    const announced: Array<{ text: string; accountIds: string[]; link: string | null }> = [];
    app.runtime.ctx.notifier = {
      enabled: true,
      connected: true,
      detail: 'prueba',
      notifyAlert: () => undefined,
      notifyTask: () => undefined,
      announce: (text, accountIds, link) => announced.push({ text, accountIds, link: link ?? null }),
    };
    const created = await call<OperationDetail>('POST', '/api/operations', config);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const opId = created.json.summary.id;
    const validate = await call<{ ok: boolean; message: string }>('POST', `/api/operations/${opId}/commands`, { command: 'validate' });
    assert.equal(validate.json.ok, true, JSON.stringify(validate.json));
    const arm = await call<{ ok: boolean; message: string }>('POST', `/api/operations/${opId}/commands`, { command: 'arm' });
    assert.equal(arm.json.ok, true, arm.json.message);
    await clock.advance(5000);

    const tasks = async () => (await call<HumanTask[]>('GET', '/api/human-tasks')).json.filter((t) => t.operationId === opId);
    const sessionTasks = (await tasks()).filter((t) => t.kind === 'OPEN_SESSION' && t.state === 'OPEN');
    assert.equal(sessionTasks.length, 2, 'una tarea de inicio de sesión por cuenta');
    for (const t of sessionTasks) {
      assert.equal(t.link, rmEvent.url, 'la tarea lleva el enlace oficial del partido');
      assert.match(t.instructions, /antes de las 18:05/, 'hora de Madrid');
      assert.match(t.instructions, /Plan: la venta abre a las 18:05\. Irás a por 1\) Lateral Este · Primer anfiteatro, 2\) Fondo Sur; hasta 2 entradas, máximo 120,00/);
    }

    // Nadie ha iniciado sesión todavía y llega T0: en asistencia manual la operación arranca igual.
    await clock.advance(t0 - clock.now() + 1000);
    const running = await call<OperationDetail>('GET', `/api/operations/${opId}`);
    assert.equal(running.json.summary.state, 'RUNNING');
    const opening = announced.filter((a) => /Abre la venta/.test(a.text));
    // Primero al chat principal y después a quien no recibe tarea (aquí las dos: ninguna tiene la sesión lista).
    assert.equal(opening.length, 2, 'aviso de apertura a todo el grupo');
    assert.deepEqual(opening[0]?.accountIds, []);
    assert.deepEqual(opening[1]?.accountIds, [ana.json.id, bea.json.id]);
    assert.match(opening[0]?.text ?? '', /2 cuentas sin «Sesión lista»/);
    assert.equal(opening[0]?.link, rmEvent.url);
    // Antes de abrir: «entrad ya en la web» a quien no tenía la sesión lista (al armar, a T−5, y a T−2).
    const entry = announced.filter((a) => /Entrad YA en la web oficial/.test(a.text));
    assert.equal(entry.length, 2);
    assert.equal(entry[0]?.link, rmEvent.url);
    assert.match(entry[1]?.text ?? '', /Últimos/);

    // Ana inicia sesión en la web oficial y lo confirma.
    const anaSession = sessionTasks.find((t) => t.accountId === ana.json.id);
    await call('POST', `/api/human-tasks/${anaSession?.id}/respond`, { result: 'READY' });
    await clock.advance(1500);
    const add = (await tasks()).find((t) => t.kind === 'ADD_TO_CART' && t.state === 'OPEN' && t.accountId === ana.json.id);
    assert.ok(add, 'tarea de añadir al carrito para Ana');
    assert.equal(add?.link, rmEvent.url);
    assert.equal(add?.target?.sectionLabel, 'Lateral Este · Primer anfiteatro');
    assert.equal(add?.target?.qty, 2, 'límite de 2 por titular');
    assert.equal(add?.target?.maxUnitPrice, 12_000);

    // Ana consigue 2 entradas a 95 € y el carrito caduca en 10 minutos.
    const expiresAt = iso(clock.now() + 10 * 60_000);
    const resp = await call<HumanTask>('POST', `/api/human-tasks/${add?.id}/respond`, { result: 'IN_CART', qty: 2, unitPrice: 9500, expiresAt });
    assert.equal(resp.status, 200, JSON.stringify(resp.json));
    await clock.advance(1500);
    const carts = (await call<Cart[]>('GET', '/api/carts')).json.filter((c) => c.operationId === opId);
    assert.equal(carts.length, 1);
    assert.equal(carts[0]?.qty, 2);
    assert.equal(carts[0]?.openUrl, null, 'la página del evento no se presenta como enlace al carrito');
    assert.equal(carts[0]?.confirmation, 'HUMAN');

    // El sistema nunca paga: lo marca una persona cuando ha pagado en la web oficial.
    const paid = await call<Cart>('POST', `/api/carts/${carts[0]?.id}/mark`, { state: 'PAID' });
    assert.equal(paid.json.state, 'PAID');
    const detail = await call<OperationDetail>('GET', `/api/operations/${opId}`);
    assert.equal(detail.json.allocation?.cartedQty, 2);
    assert.equal(app.runtime.ctx.gateway.totalCalls(), 0, 'ninguna llamada automática al proveedor');
  });
});
