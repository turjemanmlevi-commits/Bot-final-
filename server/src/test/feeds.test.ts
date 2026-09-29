/**
 * Fuentes oficiales de eventos: Ticketmaster (Discovery API) y partidos
 * (football-data.org), contra servidores locales que imitan las APIs.
 *
 * - Lectura del límite de compra oficial y de las fechas (hora de Madrid).
 * - Recinto del vault → recintos de Ticketmaster; club del estadio → partidos.
 * - Claves desde el dashboard (se comprueban y se guardan en .env).
 * - Vigilancia antes de la venta: recordatorios, cambios oficiales y
 *   actualización automática de la nota del evento.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Hono } from 'hono';
import type { Alert, FeedEventsResult, FeedKeyResult, HumanTask } from '@to/shared';
import { createApp, type App } from '../app';
import { clubMatches, localDateTime, venueNameScore } from '../feeds/common';
import { FeedControl } from '../feeds/control';
import { normalizeMatch } from '../feeds/football';
import { normalizeTmEvent, parseTicketLimit } from '../feeds/ticketmaster';
import { EventWatcher } from '../feeds/watcher';
import { writeFixtureVault } from '../gates/fixtures';
import { createHttpApp } from '../http/app';
import type { Notifier } from '../runtime/context';
import { MemoryDriver } from '../store/drivers';
import type { Clock } from '../util/clock';
import { SeqIdGen } from '../util/ids';
import { setLogSilent } from '../util/log';
import { FakeFootballData, FakeTicketmaster, FD_TOKEN, TM_KEY, type RawTmEvent } from './fake-feeds';

/** Jueves 1 de octubre de 2026, 10:00 en Madrid. */
const NOW = Date.parse('2026-10-01T08:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const TZ = 'Europe/Madrid';

/** Reloj que solo avanza cuando la prueba lo dice (sin temporizadores). */
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

class RecordingNotifier implements Notifier {
  readonly enabled = true;
  readonly connected = true;
  readonly detail = '';
  alerts: Alert[] = [];
  announced: Array<{ text: string; accountIds: string[]; link: string | null | undefined }> = [];
  notifyAlert(alert: Alert): void {
    this.alerts.push(alert);
  }
  notifyTask(_task: HumanTask): void {}
  announce(text: string, accountIds: string[], link?: string | null): void {
    this.announced.push({ text, accountIds, link });
  }
}

function tmEvent(p: {
  id: string;
  name: string;
  venue: { id: string; name: string };
  start: string;
  sale?: string;
  presales?: Array<{ name: string; startDateTime: string }>;
  status?: string;
  limit?: string;
}): RawTmEvent {
  return {
    id: p.id,
    name: p.name,
    url: `https://www.ticketmaster.es/event/${p.id}`,
    dates: { start: { dateTime: p.start, localDate: p.start.slice(0, 10) }, timezone: TZ, status: { code: p.status ?? 'onsale' } },
    sales: { public: p.sale ? { startDateTime: p.sale, endDateTime: p.start } : { startTBD: true }, presales: p.presales ?? [] },
    ...(p.limit ? { ticketLimit: { info: p.limit } } : {}),
    priceRanges: [{ type: 'standard', currency: 'EUR', min: 45, max: 120 }],
    classifications: [{ primary: true, segment: { name: 'Music' }, genre: { name: 'Pop' } }],
    _embedded: { venues: [{ id: p.venue.id, name: p.venue.name, city: { name: 'Madrid' }, timezone: TZ }] },
  };
}

const MA = { id: 'VEN-MA', name: 'Movistar Arena' };
const WZ = { id: 'VEN-WZ', name: 'WiZink Center' };
const MADARENA = { id: 'VEN-MADARENA', name: 'Madrid Arena' };

function seedTicketmaster(tm: FakeTicketmaster): void {
  tm.venues = [
    { ...MA, city: { name: 'Madrid' }, aliases: ['WiZink Center'] },
    { ...WZ, city: { name: 'Madrid' } },
    { ...MADARENA, city: { name: 'Madrid' } },
    { id: 'VEN-BER', name: 'Estadio Santiago Bernabéu', city: { name: 'Madrid' } },
  ];
  tm.events = [
    tmEvent({ id: 'TM-MORAT', name: 'Morat - Los Estadios', venue: MA, start: '2026-10-10T19:00:00Z', sale: '2026-06-01T08:00:00Z', limit: 'Hay un límite de 6 entradas por cliente.' }),
    tmEvent({
      id: 'TM-AITANA',
      name: 'Aitana - Cuarto Azul',
      venue: WZ,
      start: '2026-10-12T18:30:00Z',
      sale: '2026-10-02T08:00:00Z',
      presales: [{ name: 'Preventa Movistar+', startDateTime: '2026-09-30T08:00:00Z' }],
      status: 'offsale',
      limit: 'There is an overall 4 ticket limit on this event.',
    }),
    tmEvent({ id: 'TM-LEJANO', name: 'Gira 2027', venue: MA, start: '2027-03-01T20:00:00Z', sale: '2026-10-05T08:00:00Z', status: 'offsale' }),
    tmEvent({ id: 'TM-OTRO', name: 'Otro recinto', venue: MADARENA, start: '2026-10-05T19:00:00Z', sale: '2026-06-01T08:00:00Z' }),
  ];
}

function seedFootball(fd: FakeFootballData): void {
  const rm = { id: 86, name: 'Real Madrid CF', shortName: 'Real Madrid', tla: 'RMA' };
  const atm = { id: 78, name: 'Club Atlético de Madrid', shortName: 'Atleti', tla: 'ATM' };
  const get = { id: 82, name: 'Getafe CF', shortName: 'Getafe', tla: 'GET' };
  const juv = { id: 109, name: 'Juventus FC', shortName: 'Juventus', tla: 'JUV' };
  const sev = { id: 559, name: 'Sevilla FC', shortName: 'Sevilla FC', tla: 'SEV' };
  fd.matches = [
    { id: 1001, utcDate: '2026-10-04T19:00:00Z', status: 'TIMED', matchday: 8, competition: { code: 'PD', name: 'Primera Division' }, homeTeam: rm, awayTeam: atm },
    { id: 1002, utcDate: '2026-10-08T19:00:00Z', status: 'TIMED', matchday: 9, competition: { code: 'PD', name: 'Primera Division' }, homeTeam: get, awayTeam: rm },
    { id: 1003, utcDate: '2026-10-06T19:00:00Z', status: 'TIMED', competition: { code: 'CL', name: 'UEFA Champions League' }, homeTeam: rm, awayTeam: juv },
    { id: 1004, utcDate: '2026-10-25T00:00:00Z', status: 'SCHEDULED', matchday: 11, competition: { code: 'PD', name: 'Primera Division' }, homeTeam: rm, awayTeam: sev },
  ];
}

async function note(root: string, rel: string, fm: string, body = ''): Promise<void> {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\n${fm.trim()}\n---\n\n${body}\n`, 'utf8');
}

/** Vault de pruebas + Movistar Arena, el Bernabéu (con su club) y un evento vigilado de Ticketmaster. */
async function writeFeedVault(dir: string): Promise<void> {
  await writeFixtureVault(dir);
  await note(dir, '10 Recintos/Movistar Arena/Movistar Arena.md', 'type: venue\nid: movistar-arena\nname: Movistar Arena\ncity: Madrid\naliases: ["WiZink Center", "Palacio de los Deportes"]\nsource: prueba');
  await note(dir, '10 Recintos/Movistar Arena/Zonas/Pista.md', 'type: zone');
  await note(dir, '10 Recintos/Movistar Arena/Secciones/Pista general.md', 'type: section\nzone: "[[Pista]]"\nkind: STANDING');
  await note(
    dir,
    '10 Recintos/Estadio Santiago Bernabéu/Estadio Santiago Bernabéu.md',
    'type: venue\nid: estadio-santiago-bernabeu\nname: Estadio Santiago Bernabéu\ncity: Madrid\nclub: ["Real Madrid", "Real Madrid CF"]\naliases: ["Bernabéu"]\nsource: prueba',
  );
  await note(dir, '10 Recintos/Estadio Santiago Bernabéu/Zonas/Fondo Sur.md', 'type: zone');
  await note(dir, '10 Recintos/Estadio Santiago Bernabéu/Secciones/Fondo Sur Grada.md', 'type: section\nzone: "[[Fondo Sur]]"\nkind: SEATED');
  await note(
    dir,
    '20 Eventos/Aitana.md',
    [
      'type: event',
      'id: evt-aitana',
      'name: Aitana - Cuarto Azul',
      'venue: "[[Movistar Arena]]"',
      'provider: "[[Manual]]"',
      'providerEventRef: TM-AITANA',
      'url: https://www.ticketmaster.es/event/TM-AITANA',
      'startsAt: 2026-10-12T20:30',
      'onSaleAt: 2026-10-02T10:00',
      'currency: EUR',
      'limitPerAccount: 4',
      'limitPerGroup: 4',
      'limitPerOperation: 8',
      'limitSemantics: PER_HOLDER',
      'limitsVerified: true',
      'limitsSource: "Ticketmaster: There is an overall 4 ticket limit on this event."',
      'officialFeed: ticketmaster',
      'officialId: TM-AITANA',
      'officialSale: Venta general',
      'watchDaysBefore: 2',
    ].join('\n'),
    '# Aitana\n\nNotas que no se tocan.',
  );
}

// ---------------------------------------------------------------------------

describe('lectura de los datos oficiales', () => {
  it('lee el límite de compra en español y en inglés (y no se inventa uno)', () => {
    assert.equal(parseTicketLimit('Hay un límite de 6 entradas por cliente.').perCustomer, 6);
    assert.equal(parseTicketLimit('There is an overall 4 ticket limit on this event.').perCustomer, 4);
    assert.equal(parseTicketLimit('Máximo 2 entradas por persona').perCustomer, 2);
    assert.equal(parseTicketLimit('Ticket limit: 8 per customer').perCustomer, 8);
    assert.equal(parseTicketLimit('Límite de compra: 4 entradas por usuario y evento.').perCustomer, 4);
    assert.equal(parseTicketLimit('Límite de 4 entradas por tarjeta').semantics, 'PER_PAYMENT_METHOD');
    assert.equal(parseTicketLimit('Hay un límite de 6 entradas por cliente.').semantics, 'PER_HOLDER');
    assert.equal(parseTicketLimit('Apertura de puertas a las 19:00. Aforo 15.000').perCustomer, null);
    assert.equal(parseTicketLimit('').perCustomer, null);
    // En notas libres, «2 entradas por 60 €» no es un límite.
    assert.equal(parseTicketLimit('Oferta: 2 entradas por 60 €', { strict: true }).perCustomer, null);
    assert.equal(parseTicketLimit('Oferta: 2 entradas por 60 €. Máximo 4 entradas por persona.', { strict: true }).perCustomer, 4);
  });

  it('pasa las fechas de Ticketmaster a hora de Madrid (con cambio de hora) y ordena las ventas', () => {
    const e = normalizeTmEvent(
      tmEvent({
        id: 'X1',
        name: 'Prueba',
        venue: MA,
        start: '2026-10-27T20:00:00Z',
        sale: '2026-10-01T08:00:00Z',
        presales: [
          { name: 'Preventa B', startDateTime: '2026-09-29T08:00:00Z' },
          { name: 'Preventa A', startDateTime: '2026-09-28T08:00:00Z' },
        ],
        limit: 'Hay un límite de 6 entradas por cliente.',
      }) as never,
      TZ,
    );
    assert.ok(e);
    assert.equal(e.startsAtLocal, '2026-10-27T21:00'); // noviembre: +1
    assert.equal(e.sales[0]?.name, 'Venta general');
    assert.equal(e.sales[0]?.startsAtLocal, '2026-10-01T10:00'); // octubre: +2
    assert.deepEqual(
      e.sales.slice(1).map((s) => s.name),
      ['Preventa A', 'Preventa B'],
    );
    assert.equal(e.limit.perCustomer, 6);
    assert.equal(e.status, 'ONSALE');
    assert.equal(e.category, 'Música · Pop');
    assert.equal(e.price?.min, 45);
    assert.equal(e.venue?.name, 'Movistar Arena');
    assert.equal(e.saleTBD, false);
  });

  it('venta sin fecha y hora del recinto en Canarias', () => {
    const raw = tmEvent({ id: 'X2', name: 'Canarias', venue: MA, start: '2026-11-07T21:00:00Z' });
    raw.dates.timezone = 'Atlantic/Canary';
    const e = normalizeTmEvent(raw as never, TZ);
    assert.ok(e);
    assert.equal(e.saleTBD, true);
    assert.equal(e.sales.length, 0);
    assert.equal(e.startsAtLocal, '2026-11-07T22:00');
    assert.equal(e.venueLocalTime, '21:00');
  });

  it('partidos: la hora sin fijar se marca y el nombre dice la competición', () => {
    const m = normalizeMatch(
      {
        id: 7,
        utcDate: '2026-10-25T00:00:00Z',
        status: 'SCHEDULED',
        matchday: 11,
        competition: { code: 'PD', name: 'Primera Division' },
        homeTeam: { name: 'Real Madrid CF', shortName: 'Real Madrid' },
        awayTeam: { name: 'Sevilla FC', shortName: 'Sevilla FC' },
      },
      TZ,
    );
    assert.ok(m);
    assert.equal(m.event.name, 'Real Madrid – Sevilla FC · LaLiga (jornada 11)');
    assert.equal(m.event.timeTBA, true);
    assert.deepEqual(m.homeNames, ['Real Madrid CF', 'Real Madrid']);
  });

  it('reconoce el recinto y el club sin confundir parecidos', () => {
    const madrid = ['madrid'];
    assert.equal(venueNameScore(['Movistar Arena', 'WiZink Center'], ['WiZink Center'], madrid), 1);
    assert.ok(venueNameScore(['IFEMA Madrid'], ['IFEMA - Feria de Madrid'], madrid) >= 0.8);
    assert.ok(venueNameScore(['Estadio Santiago Bernabéu', 'Bernabéu'], ['Santiago Bernabéu Stadium'], madrid) >= 0.8);
    assert.equal(venueNameScore(['Madrid Arena'], ['Movistar Arena'], madrid), 0);
    assert.equal(venueNameScore(['Madrid Arena'], ['Estadio Metropolitano Madrid'], madrid), 0);
    assert.equal(venueNameScore(['Estadio de la Cerámica'], ['Estadio de Vallecas'], ['villarreal']), 0);

    assert.ok(clubMatches(['Real Madrid'], ['Real Madrid CF', 'Real Madrid']));
    assert.ok(clubMatches(['Atlético de Madrid'], ['Club Atlético de Madrid', 'Atleti']));
    assert.ok(clubMatches(['Rayo Vallecano'], ['Rayo Vallecano de Madrid']));
    assert.ok(clubMatches(['Athletic Club'], ['Athletic Club', 'Athletic']));
    assert.ok(!clubMatches(['Real Madrid'], ['Rayo Vallecano de Madrid']));
    assert.ok(!clubMatches(['RC Deportivo'], ['Deportivo Alavés', 'Alavés']));
    assert.ok(!clubMatches(['FC Barcelona'], ['RCD Espanyol de Barcelona', 'Espanyol']));
  });

  it('las fechas locales salen en «AAAA-MM-DDTHH:mm»', () => {
    assert.equal(localDateTime(Date.parse('2026-07-01T10:00:00Z'), TZ), '2026-07-01T12:00');
    assert.equal(localDateTime(Date.parse('2026-12-31T23:30:00Z'), TZ), '2027-01-01T00:30');
  });
});

// ---------------------------------------------------------------------------

describe('fuentes oficiales desde el dashboard', () => {
  let tm: FakeTicketmaster;
  let fd: FakeFootballData;
  let dir = '';
  let envFile = '';
  let app: App;
  let feeds: FeedControl;
  let http: Hono;

  before(async () => {
    setLogSilent(true);
    tm = new FakeTicketmaster();
    fd = new FakeFootballData();
    seedTicketmaster(tm);
    seedFootball(fd);
    const [tmBase, fdBase] = await Promise.all([tm.listen(), fd.listen()]);
    dir = await mkdtemp(path.join(tmpdir(), 'to-feeds-'));
    await writeFeedVault(dir);
    envFile = path.join(dir, '.env');
    await writeFile(envFile, '# Mi configuración\r\nPORT=8787\r\nTICKETMASTER_API_KEY=\r\n');
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    feeds = new FeedControl({ runtime: app.runtime, timeZone: TZ, envFile, ticketmasterBase: tmBase, footballBase: fdBase, fast: true });
    http = createHttpApp(app, { dashboardDist: null, operatorToken: null, feeds });
  });

  after(async () => {
    await app.stop();
    await Promise.all([tm.close(), fd.close()]);
    await rm(dir, { recursive: true, force: true });
  });

  const put = (feed: string, body: unknown, headers: Record<string, string> = {}) =>
    http.request(`/api/feeds/${feed}/key`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('sin clave, lo explica en vez de fallar', async () => {
    const res = await http.request('/api/feeds/events?feed=ticketmaster&venueId=movistar-arena&days=14');
    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: { message: string } };
    assert.match(body.error.message, /Ajustes · Fuentes de eventos/);
    const status = app.runtime.ctx.ops.systemStatus().feeds;
    assert.equal(status.ticketmaster.configured, false);
    assert.equal(status.configurable, true);
  });

  it('una clave equivocada no se guarda y se explica', async () => {
    const res = await put('ticketmaster', { key: 'claveEquivocada1234567890' });
    const r = (await res.json()) as FeedKeyResult;
    assert.equal(r.ok, false);
    assert.match(r.message, /Consumer Key/);
    assert.doesNotMatch(r.message, /claveEquivocada/);
    assert.match(await readFile(envFile, 'utf8'), /^TICKETMASTER_API_KEY=\r$/m);
  });

  it('otra web no puede cambiar la clave', async () => {
    const res = await put('ticketmaster', { key: TM_KEY }, { origin: 'https://malicioso.example' });
    assert.equal(res.status, 403);
  });

  it('la clave buena se comprueba, se guarda en .env (sin tocar lo demás) y no sale por la API', async () => {
    const res = await put('ticketmaster', { key: `  ${TM_KEY}  ` });
    const r = (await res.json()) as FeedKeyResult;
    assert.equal(r.ok, true, r.message);
    assert.equal(r.status.ticketmaster.configured, true);
    assert.equal(r.status.ticketmaster.ok, true);
    const text = await readFile(envFile, 'utf8');
    assert.equal(text, `# Mi configuración\r\nPORT=8787\r\nTICKETMASTER_API_KEY=${TM_KEY}\r\n`);
    const state = await (await http.request('/api/state')).text();
    assert.ok(!state.includes(TM_KEY), 'la clave no puede salir por la API');
  });

  it('próximos 14 días del recinto: incluye su nombre antiguo y no confunde otro recinto', async () => {
    const res = await http.request('/api/feeds/events?feed=ticketmaster&venueId=movistar-arena&days=14');
    assert.equal(res.status, 200);
    const r = (await res.json()) as FeedEventsResult;
    assert.deepEqual(
      r.events.map((e) => e.id),
      ['TM-MORAT', 'TM-AITANA'],
    );
    assert.deepEqual(r.matched.map((v) => v.id).sort(), ['VEN-MA', 'VEN-WZ']);
    const aitana = r.events[1];
    assert.equal(aitana?.limit.perCustomer, 4);
    assert.equal(aitana?.sales.find((s) => s.kind === 'PUBLIC')?.startsAtLocal, '2026-10-02T10:00');
    assert.equal(aitana?.sales.find((s) => s.kind === 'PRESALE')?.name, 'Preventa Movistar+');
    assert.equal(aitana?.startsAtLocal, '2026-10-12T20:30');
    // Siempre con locale=* y fechas sin milisegundos (si no, la API real no devuelve eventos de España).
    for (const c of tm.calls.filter((x) => x.path.endsWith('events.json'))) {
      assert.equal(c.params.locale, '*');
      assert.equal(c.params.countryCode, 'ES');
    }
  });

  it('ventas que abren en los próximos 14 días (aunque el evento sea después)', async () => {
    const r = (await (await http.request('/api/feeds/events?feed=ticketmaster&venueId=movistar-arena&days=14&by=sale')).json()) as FeedEventsResult;
    assert.deepEqual(
      r.events.map((e) => e.id),
      ['TM-AITANA', 'TM-LEJANO'],
    );
  });

  it('búsqueda por nombre en toda España, marcando si es en el recinto elegido', async () => {
    const r = (await (await http.request('/api/feeds/events?feed=ticketmaster&venueId=movistar-arena&days=30&q=aitana')).json()) as FeedEventsResult;
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0]?.atVenue, true);
    const none = (await (await http.request('/api/feeds/events?feed=ticketmaster&days=30&q=nadie')).json()) as FeedEventsResult;
    assert.equal(none.events.length, 0);
    assert.match(none.message ?? '', /no tiene eventos de «nadie»/);
  });

  it('un evento concreto, tal y como está ahora', async () => {
    const res = await http.request('/api/feeds/ticketmaster/events/TM-AITANA');
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { name: string }).name, 'Aitana - Cuarto Azul');
    assert.equal((await http.request('/api/feeds/ticketmaster/events/NO-EXISTE')).status, 404);
  });

  it('partidos: solo los del club en casa (LaLiga y Champions), con token de football-data.org', async () => {
    const bad = (await (await put('football', { key: 'tokenEquivocado123456' })).json()) as FeedKeyResult;
    assert.equal(bad.ok, false);
    assert.match(bad.message, /token/);
    const ok = (await (await put('football', { key: FD_TOKEN })).json()) as FeedKeyResult;
    assert.equal(ok.ok, true, ok.message);
    assert.match(await readFile(envFile, 'utf8'), new RegExp(`^FOOTBALL_DATA_TOKEN=${FD_TOKEN}\\r$`, 'm'));

    const r = (await (await http.request('/api/feeds/events?feed=football&venueId=estadio-santiago-bernabeu&days=14')).json()) as FeedEventsResult;
    assert.deepEqual(
      r.events.map((e) => e.id),
      ['1001', '1003'],
    );
    assert.equal(r.events[0]?.name, 'Real Madrid – Atleti · LaLiga (jornada 8)');
    assert.equal(r.events[0]?.startsAtLocal, '2026-10-04T21:00');

    const month = (await (await http.request('/api/feeds/events?feed=football&venueId=estadio-santiago-bernabeu&days=30')).json()) as FeedEventsResult;
    assert.equal(month.events.at(-1)?.id, '1004');
    assert.equal(month.events.at(-1)?.timeTBA, true);
  });

  it('partidos: si la cuenta no tiene la Champions, salen los de LaLiga y se avisa', async () => {
    fd.restricted.add('CL');
    const r = (await (await http.request('/api/feeds/events?feed=football&venueId=estadio-santiago-bernabeu&days=15')).json()) as FeedEventsResult;
    assert.deepEqual(
      r.events.map((e) => e.id),
      ['1001'],
    );
    assert.match(r.message ?? '', /Champions League: no está en tu cuenta/);
    fd.restricted.delete('CL');
  });

  it('un recinto sin club no tiene partidos (y lo explica)', async () => {
    const r = (await (await http.request('/api/feeds/events?feed=football&venueId=movistar-arena&days=14')).json()) as FeedEventsResult;
    assert.equal(r.events.length, 0);
    assert.match(r.message ?? '', /no tiene club/);
  });

  it('quitar la clave', async () => {
    const r = (await (await put('football', { key: null })).json()) as FeedKeyResult;
    assert.equal(r.ok, true);
    assert.equal(r.status.football.configured, false);
    assert.match(await readFile(envFile, 'utf8'), /^FOOTBALL_DATA_TOKEN=\r$/m);
  });
});

// ---------------------------------------------------------------------------

describe('vigilancia antes de la venta', () => {
  let tm: FakeTicketmaster;
  let dir = '';
  let app: App;
  let clock: ManualClock;
  let tg: RecordingNotifier;
  let watcher: EventWatcher;
  let driver: MemoryDriver;

  before(async () => {
    setLogSilent(true);
    tm = new FakeTicketmaster();
    seedTicketmaster(tm);
    const base = await tm.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-watch-'));
    await writeFeedVault(dir);
    clock = new ManualClock(NOW);
    tg = new RecordingNotifier();
    driver = new MemoryDriver();
    app = await createApp({ driver, vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock, ids: new SeqIdGen(), notifier: tg });
    assert.deepEqual(app.runtime.store.vaultReport?.errors, []);
    const feeds = new FeedControl({ runtime: app.runtime, timeZone: TZ, envFile: null, ticketmasterBase: base, fast: true }, { ticketmasterKey: TM_KEY });
    watcher = new EventWatcher({ app, feeds, timeZone: TZ });
  });

  after(async () => {
    watcher.stop();
    await app.stop();
    await tm.close();
    await rm(dir, { recursive: true, force: true });
  });

  const watch = () => app.runtime.store.watches.get('evt-aitana');
  const texts = () => tg.announced.map((a) => a.text);

  it('el evento vigilado sale del vault con su fuente oficial', () => {
    const e = app.runtime.store.events.get('evt-aitana');
    assert.ok(e);
    assert.equal(e.officialFeed, 'ticketmaster');
    assert.equal(e.officialId, 'TM-AITANA');
    assert.equal(e.officialSale, 'Venta general');
    assert.equal(e.watchDaysBefore, 2);
  });

  it('dentro de la ventana: avisa de que empieza a vigilar y toma la foto oficial', async () => {
    await watcher.tick();
    const w = watch();
    assert.ok(w);
    assert.equal(w.state, 'WATCHING');
    assert.equal(w.anchorKind, 'SALE');
    assert.equal(w.anchor, '2026-10-02T08:00:00.000Z');
    assert.equal(w.from, '2026-09-30T08:00:00.000Z');
    assert.ok(w.snapshot);
    assert.equal(w.lastError, null);
    assert.equal(tg.announced.length, 1);
    assert.match(texts()[0] ?? '', /Vigilando: Aitana/);
    assert.equal(tg.announced[0]?.link, 'https://www.ticketmaster.es/event/TM-AITANA');
    // Otra pasada enseguida: ni consulta ni aviso repetido.
    const calls = tm.calls.length;
    await watcher.tick();
    assert.equal(tm.calls.length, calls);
    assert.equal(tg.announced.length, 1);
  });

  it('si Ticketmaster cambia la hora de la venta: alerta, Telegram y la nota se actualiza sola', async () => {
    const e = tm.events.find((x) => x.id === 'TM-AITANA');
    assert.ok(e?.sales?.public);
    e.sales.public.startDateTime = '2026-10-02T09:00:00Z';
    clock.t += 10 * MIN;
    await watcher.tick();
    const alert = [...app.runtime.store.alerts.values()].find((a) => a.kind === 'EVENT_WATCH');
    assert.ok(alert, 'debe haber una alerta de vigilancia');
    assert.equal(alert.severity, 'WARNING');
    assert.match(alert.message, /Venta general: ahora abre/);
    assert.match(alert.message, /Ya está actualizado en el evento/);
    assert.ok(tg.alerts.some((a) => a.id === alert.id), 'la alerta llega a Telegram');
    const text = await readFile(path.join(dir, '20 Eventos/Aitana.md'), 'utf8');
    assert.match(text, /^onSaleAt: 2026-10-02T11:00$/m);
    assert.match(text, /Notas que no se tocan\./);
    assert.equal(app.runtime.store.events.get('evt-aitana')?.onSaleAt, '2026-10-02T09:00:00.000Z');
    assert.equal(watch()?.changes[0]?.text.startsWith('Venta general: ahora abre'), true);
  });

  it('recordatorios: el día antes y una hora antes (sin operación armada lo dice)', async () => {
    clock.t = Date.parse('2026-10-01T10:00:00Z');
    await watcher.tick();
    assert.equal(watch()?.anchor, '2026-10-02T09:00:00.000Z');
    assert.ok(texts().some((t) => t.startsWith('⏰ <b>Mañana: Aitana')));
    clock.t = Date.parse('2026-10-02T08:05:00Z');
    await watcher.tick();
    const hour = texts().find((t) => t.startsWith('⏰ <b>En 1 hora'));
    assert.ok(hour);
    assert.match(hour, /Todavía no hay ninguna operación armada/);
    const n = tg.announced.length;
    await watcher.tick();
    assert.equal(tg.announced.length, n, 'cada recordatorio una sola vez');
  });

  it('en las horas finales consulta más a menudo y avisa si baja el límite oficial', async () => {
    const e = tm.events.find((x) => x.id === 'TM-AITANA');
    assert.ok(e);
    e.ticketLimit = { info: 'Hay un límite de 2 entradas por cliente.' };
    clock.t += 2 * MIN;
    await watcher.tick();
    const critical = [...app.runtime.store.alerts.values()].find((a) => a.kind === 'EVENT_WATCH' && a.severity === 'CRITICAL');
    assert.ok(critical);
    assert.match(critical.message, /Límite de compra oficial: «Hay un límite de 2 entradas por cliente\.»/);
    // El límite nunca se cambia solo: lo revisa una persona.
    assert.equal(app.runtime.store.events.get('evt-aitana')?.limits.perAccount, 4);
  });

  it('al abrir la venta sin operación armada, avisa; una hora después deja de vigilar', async () => {
    clock.t = Date.parse('2026-10-02T09:00:30Z');
    await watcher.tick();
    assert.ok(texts().some((t) => t.startsWith('🔔 <b>Abre la venta: Aitana')));
    clock.t = Date.parse('2026-10-02T10:01:00Z');
    const calls = tm.calls.length;
    await watcher.tick();
    assert.equal(watch()?.state, 'DONE');
    assert.equal(tm.calls.length, calls, 'ya no consulta');
  });

  it('la vigilancia se guarda (sobrevive a un reinicio)', async () => {
    await app.runtime.ctx.journal.close();
    const rows = await driver.loadEntities();
    const row = rows.find((r) => r.kind === 'eventWatch' && r.id === 'evt-aitana');
    assert.ok(row);
    assert.ok((row.data as { sent: string[] }).sent.includes('hour'));
  });
});
