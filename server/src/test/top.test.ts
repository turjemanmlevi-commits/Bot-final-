/**
 * ⭐ Grandes partidos y «1 entrada por cuenta»:
 *
 * - Tope por cuenta de la operación (más estricto que el oficial) y su validación.
 * - Compra de un gran partido: todas las cuentas a la vez, 1 entrada cada una, y
 *   avisos «entrad ya en la web» a T−30, T−10 y T−2 a quien no tiene sesión lista.
 * - Lista de Claude: búsquedas en paralelo, sin repetidos, las más importantes,
 *   guardada en disco y enlazada con su estadio, su web de venta y su evento.
 * - Telegram /top: tocar un partido lo prepara con vigilancia de 2 semanas y 1 por cuenta.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { TOP_PER_ACCOUNT, TOP_WATCH_DAYS, type Alert, type HumanTask } from '@to/shared';
import { createApp, type App } from '../app';
import { EventAssistant } from '../ai/assistant';
import { ClaudeControl } from '../ai/claude';
import { TOP_SEARCHES, TopMatches } from '../ai/top';
import { initAllocation } from '../domain/allocation';
import { validateConfig } from '../domain/validation';
import { FIXTURE_MANUAL_EVENT, writeFixtureVault } from '../gates/fixtures';
import { createHarness, manualConfig, type Harness } from '../gates/harness';
import type { Notifier } from '../runtime/context';
import { MemoryDriver } from '../store/drivers';
import { TelegramNotifier } from '../telegram/telegram';
import type { Clock } from '../util/clock';
import { SeqIdGen } from '../util/ids';
import { setLogSilent } from '../util/log';
import { iso } from '../util/time';
import { VaultAuthoring } from '../vault/authoring';
import { AI_KEY, deliver, FakeAnthropic, type FakeReply } from './fake-anthropic';
import { FakeTelegram, TOKEN, until } from './fake-telegram';

const MIN = 60_000;

describe('1 entrada por cuenta', () => {
  it('el tope de la operación es más estricto que el límite oficial (nunca más permisivo)', () => {
    const limits = { perAccount: 4, perGroup: 4, perOperation: 12, semantics: 'PER_ACCOUNT' as const, verified: true, source: 'x', notes: '', verifiedAt: null, verifiedBy: null };
    const accounts = [
      { id: 'a', groupKey: 'a' },
      { id: 'b', groupKey: 'b' },
    ];
    const one = initAllocation({ operationId: 'op', currency: 'EUR', requestedQty: 2, maxUnitPrice: 100, budget: 1000, limits, accounts, perAccountCap: 1 });
    assert.deepEqual(
      Object.values(one.perAccount).map((a) => a.cap),
      [1, 1],
    );
    const loose = initAllocation({ operationId: 'op', currency: 'EUR', requestedQty: 2, maxUnitPrice: 100, budget: 1000, limits, accounts, perAccountCap: 9 });
    assert.deepEqual(
      Object.values(loose.perAccount).map((a) => a.cap),
      [4, 4],
      'un tope mayor que el oficial no amplía el límite',
    );
  });

  describe('compra de un gran partido', () => {
    let dir = '';
    let h: Harness;
    const announced: Array<{ text: string; accountIds: string[]; link: string | null | undefined }> = [];

    before(async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'to-top-op-'));
      await writeFixtureVault(dir);
      h = await createHarness(dir);
      const notifier: Notifier = {
        enabled: true,
        connected: true,
        detail: '',
        notifyAlert: (_a: Alert) => undefined,
        notifyTask: (_t: HumanTask) => undefined,
        announce: (text, accountIds, link) => {
          announced.push({ text, accountIds, link });
        },
      };
      h.app.runtime.ctx.notifier = notifier;
    });

    after(async () => {
      await h.stop();
      await rm(dir, { recursive: true, force: true });
    });

    it('valida que el grupo mínimo quepa en las entradas por cuenta', () => {
      const rt = h.app.runtime;
      const cfg = manualConfig([], h.clock.now());
      const event = rt.store.events.get(FIXTURE_MANUAL_EVENT) ?? null;
      const report = validateConfig({ ...cfg, preferences: { ...cfg.preferences, minGroupSize: 2, maxPerAccount: 1 } }, {
        event,
        artifact: event ? rt.store.artifactFor(event.venueId, event.id) : null,
        accounts: [],
        provider: rt.ctx.registry.descriptor('manual'),
        now: h.clock.now(),
      } as unknown as Parameters<typeof validateConfig>[1]);
      assert.ok(report.issues.some((i) => i.code === 'MIN_GROUP_ABOVE_PER_ACCOUNT'), JSON.stringify(report.issues.map((i) => i.code)));
    });

    it('todas las cuentas a la vez, 1 entrada cada una, y «entrad ya» a T−30, T−10 y T−2', async () => {
      const rt = h.app.runtime;
      const accounts = [1, 2, 3].map((i) => rt.ctx.accounts.create({ label: `Cuenta ${i}`, providerId: 'manual', holderRef: `persona${i}`, verification: 'VERIFIED' }, 't'));
      const t0 = h.clock.now() + 40 * MIN;
      const base = manualConfig(
        accounts.map((a) => a.id),
        h.clock.now(),
      );
      const op = rt.ctx.ops.create(
        {
          ...base,
          name: 'Real Madrid - FC Barcelona',
          t0: iso(t0),
          requestedQty: 3,
          maxUnitPrice: 20_000,
          budget: 60_000,
          preferences: { ...base.preferences, minGroupSize: 1, requireContiguous: false, maxPerAccount: 1 },
        },
        't',
      );
      const v = await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      assert.ok(v.ok, v.message);
      const armed = await rt.ctx.ops.command(op.id, { command: 'arm' }, 't');
      assert.ok(armed.ok, armed.message);
      assert.deepEqual(
        Object.values(rt.store.allocations.get(op.id)?.perAccount ?? {}).map((a) => a.cap),
        [1, 1, 1],
      );
      const reminders = () => announced.filter((a) => /Entrad YA en la web oficial/.test(a.text));
      await h.clock.advance(5 * MIN);
      assert.equal(reminders().length, 0, 'a T−35 todavía nada');
      await h.clock.advance(6 * MIN); // T−29
      assert.equal(reminders().length, 1);
      assert.match(reminders()[0]?.text ?? '', /Faltan (29|30) min/);
      assert.deepEqual(reminders()[0]?.accountIds.sort(), accounts.map((a) => a.id).sort(), 'a las tres cuentas sin sesión lista');
      // Dos personas ya están dentro: el siguiente aviso solo va a la tercera.
      for (const t of [...rt.store.humanTasks.values()]) {
        if (t.kind === 'OPEN_SESSION' && t.state === 'OPEN' && t.accountId !== accounts[2]?.id) rt.ctx.tasks.respond(t.id, { result: 'READY' }, 'persona');
      }
      await h.clock.advance(20 * MIN); // T−9
      assert.equal(reminders().length, 2);
      assert.deepEqual(reminders()[1]?.accountIds, [accounts[2]?.id]);
      assert.match(reminders()[1]?.text ?? '', /«Cuenta 3»/);
      await h.clock.advance(7.5 * MIN); // T−1,5
      assert.equal(reminders().length, 3);
      assert.match(reminders()[2]?.text ?? '', /Últimos/);
      for (const t of [...rt.store.humanTasks.values()]) if (t.kind === 'OPEN_SESSION' && t.state === 'OPEN') rt.ctx.tasks.respond(t.id, { result: 'READY' }, 'persona');
      await h.clock.advance(2 * MIN); // T0 pasado: arranca
      assert.equal(reminders().length, 3, 'sin repetir avisos');
      await until(
        () => [...rt.store.humanTasks.values()].filter((t) => t.kind === 'ADD_TO_CART' && t.operationId === op.id && t.state === 'OPEN').length === 3,
        'tres tareas a la vez',
        5000,
      ).catch(async () => {
        await h.clock.advance(3000);
      });
      const tasks = [...rt.store.humanTasks.values()].filter((t) => t.kind === 'ADD_TO_CART' && t.operationId === op.id && t.state === 'OPEN');
      assert.equal(tasks.length, 3, 'una tarea por cuenta, todas a la vez');
      assert.deepEqual(new Set(tasks.map((t) => t.accountId)).size, 3);
      assert.ok(
        tasks.every((t) => t.target?.qty === 1),
        JSON.stringify(tasks.map((t) => t.target?.qty)),
      );
    });
  });
});

// ---------------------------------------------------------------------------

/** Jueves 1 de octubre de 2026, 10:00 en Madrid. */
const NOW = Date.parse('2026-10-01T08:00:00Z');
const TZ = 'Europe/Madrid';

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

const M = (p: Partial<Record<string, unknown>> & { home: string; away: string; date: string }) => ({
  competition: 'LaLiga',
  category: 'LALIGA',
  importance: 60,
  why: 'Partido grande',
  time: '21:00',
  venue: null,
  city: null,
  country: 'España',
  ticketUrl: null,
  saleOpens: null,
  ...p,
});

/** Cada búsqueda (liga, Champions, Copa, selecciones) contesta según el tipo que se le pide. */
function topReply(body: Record<string, unknown>): FakeReply {
  const prompt = JSON.stringify(body.messages);
  if (/el Clásico/.test(prompt)) {
    return deliver('entregar_partidos', {
      matches: [
        M({ home: 'Real Madrid', away: 'FC Barcelona', date: '2026-10-25', time: '16:15', category: 'CLASICO', importance: 99, venue: 'Estadio Santiago Bernabéu', city: 'Madrid', ticketUrl: 'https://www.realmadrid.com/es-ES/entradas/rm-barcelona', competition: 'LaLiga · Jornada 10' }),
        M({ home: 'Atlético de Madrid', away: 'Real Madrid', date: '2027-02-14', category: 'LALIGA', importance: 85, venue: 'Riyadh Air Metropolitano', city: 'Madrid' }),
        M({ home: 'Getafe CF', away: 'Rayo Vallecano', date: '2026-11-01', importance: 20 }),
        M({ home: 'Partido', away: 'Pasado', date: '2025-01-01', importance: 99 }),
      ],
      notes: '',
    });
  }
  if (/Champions League/.test(prompt)) {
    return deliver('entregar_partidos', {
      matches: [
        // El mismo Clásico, escrito de otra forma: no se repite.
        M({ home: 'Real Madrid CF', away: 'Barça', date: '2026-10-25', category: 'CLASICO', importance: 97, venue: 'Estadio Santiago Bernabéu', city: 'Madrid', saleOpens: '2026-10-20T10:00' }),
        M({ home: 'Real Madrid', away: 'Liverpool FC', date: '2026-11-04', category: 'CHAMPIONS', importance: 90, venue: 'Estadio Santiago Bernabéu', city: 'Madrid', competition: 'Champions League · Fase liga' }),
        M({ home: 'Liverpool FC', away: 'Atlético de Madrid', date: '2026-12-09', category: 'CHAMPIONS', importance: 80, venue: 'Anfield', city: 'Liverpool', country: 'Inglaterra' }),
        { ...M({ home: 'x', away: 'y', date: '2027-06-05', category: 'FINAL', importance: 100, venue: 'Riyadh Air Metropolitano', city: 'Madrid', competition: 'Champions League · Final' }), home: null, away: null },
      ],
      notes: 'La final de 2027 se juega en el Metropolitano.',
    });
  }
  if (/Copa del Rey/.test(prompt)) {
    return deliver('entregar_partidos', { matches: [M({ home: 'Athletic Club', away: 'Real Sociedad', date: '2027-04-18', category: 'FINAL', importance: 88, venue: 'Estadio de La Cartuja', city: 'Sevilla', competition: 'Copa del Rey · Final' })], notes: '' });
  }
  return deliver('entregar_partidos', { matches: [M({ home: 'España', away: 'Italia', date: '2026-11-15', category: 'SELECCION', importance: 70, venue: 'Estadio La Rosaleda', city: 'Málaga' })], notes: '' });
}

describe('⭐ Grandes partidos', () => {
  let fake: FakeAnthropic;
  let dir = '';
  let dataDir = '';
  let app: App;
  let ai: ClaudeControl;
  let top: TopMatches;
  let file = '';

  before(async () => {
    setLogSilent(true);
    fake = new FakeAnthropic();
    const base = await fake.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-top-'));
    await writeFixtureVault(dir);
    await note(dir, '30 Proveedores/Real Madrid.md', 'type: provider\nid: real-madrid\nname: Real Madrid\nmode: MANUAL_ASSIST\nurl: https://www.realmadrid.com/es-ES/entradas\nauthorizedCapabilities: []');
    const V = '10 Recintos/Estadio Santiago Bernabéu';
    await note(dir, `${V}/Estadio Santiago Bernabéu.md`, 'type: venue\nid: estadio-santiago-bernabeu\nname: Estadio Santiago Bernabéu\ncity: Madrid\naliases: ["Bernabéu"]\nsource: prueba');
    for (const z of ['Lateral Este', 'Fondo Sur']) {
      await note(dir, `${V}/Zonas/${z}.md`, 'type: zone');
      await note(dir, `${V}/Secciones/${z} Grada.md`, `type: section\nzone: "[[${z}]]"\nkind: SEATED`);
    }
    await note(dir, '10 Recintos/Anfield/Anfield.md', 'type: venue\nid: anfield\nname: Anfield\ncity: Liverpool\nsource: prueba');
    await note(dir, '10 Recintos/Anfield/Zonas/The Kop.md', 'type: zone');
    await note(dir, '10 Recintos/Anfield/Secciones/The Kop.md', 'type: section\nzone: "[[The Kop]]"\nkind: SEATED');
    dataDir = await mkdtemp(path.join(tmpdir(), 'to-top-data-'));
    file = path.join(dataDir, 'top-partidos.json');
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    ai = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile: null, baseURL: base }, { apiKey: AI_KEY });
    const authoring = new VaultAuthoring(app);
    app.runtime.ctx.eventAssistant = new EventAssistant(app, ai, authoring);
    top = new TopMatches({ app, ai, file, timeZone: TZ });
    app.runtime.ctx.topMatches = top;
  });

  after(async () => {
    app.runtime.ctx.notifier = null;
    await app.stop();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    setLogSilent(false);
  });

  it('Claude busca en paralelo, sin repetidos, se queda con los más importantes y lo guarda', async () => {
    for (let i = 0; i < TOP_SEARCHES.length; i++) fake.script.push(topReply);
    const started = top.refresh('prueba');
    assert.equal(started.refreshing, true);
    assert.equal(top.refresh('prueba').refreshing, true, 'una segunda petición no lanza otra búsqueda');
    await top.settled();
    const st = top.state();
    assert.equal(st.refreshing, false);
    assert.equal(st.error, null);
    assert.equal(fake.messageRequests().length, TOP_SEARCHES.length, 'una consulta por tipo (sin repetir)');
    const names = st.matches.map((m) => m.name);
    assert.equal(names.filter((n) => /Madrid.*(Barcelona|Barça)/.test(n)).length, 1, 'el Clásico sale una sola vez');
    assert.ok(!names.includes('Partido - Pasado'), 'nada fuera de los próximos 12 meses');
    assert.deepEqual(
      st.matches.map((m) => m.startsAtLocal?.slice(0, 10)),
      [...st.matches.map((m) => m.startsAtLocal?.slice(0, 10))].sort(),
      'por fecha',
    );
    const clasico = st.matches.find((m) => m.category === 'CLASICO');
    assert.equal(clasico?.importance, 99);
    assert.equal(clasico?.saleOpensLocal, '2026-10-20T10:00', 'se completa con el dato de la otra búsqueda');
    assert.equal(clasico?.vaultVenueId, 'estadio-santiago-bernabeu');
    assert.equal(clasico?.providerId, 'real-madrid', 'en casa del Real Madrid: su web');
    const anfield = st.matches.find((m) => m.venue === 'Anfield');
    assert.equal(anfield?.vaultVenueId, 'anfield');
    assert.equal(anfield?.providerId, 'manual', 'fuera: «otra web oficial» (la del club local)');
    const final = st.matches.find((m) => m.category === 'FINAL' && /Champions/.test(m.competition));
    assert.equal(final?.name, 'Champions League · Final', 'una final sin equipos todavía');
    assert.match(st.notes.join(' '), /Metropolitano/);
    assert.ok((st.cost?.usd ?? 0) > 0);
    // Guardada en disco: al reiniciar no se vuelve a pagar.
    const saved = JSON.parse(await readFile(file, 'utf8')) as { matches: unknown[] };
    assert.equal(saved.matches.length, st.matches.length);
    const again = new TopMatches({ app, ai, file, timeZone: TZ });
    await again.load();
    assert.equal(again.state().matches.length, st.matches.length);
    assert.equal(fake.messageRequests().length, TOP_SEARCHES.length);
  });

  it('Telegram /top: tocar un partido lo prepara con vigilancia de 2 semanas y 1 entrada por cuenta', async () => {
    const tg = new FakeTelegram();
    const tgBase = await tg.listen();
    const bot = new TelegramNotifier({ token: TOKEN, chatId: '700', apiBase: tgBase, retryMs: 50, setupProfile: false });
    app.runtime.ctx.notifier = bot;
    bot.attach(app.runtime);
    type Btn = { text: string; callback_data?: string };
    const keyboardFor = (re: RegExp): Btn[] => {
      const m = [...tg.sent].reverse().find((x) => (x.method === 'sendMessage' || x.method === 'editMessageText') && re.test(String(x.body.text)) && x.body.reply_markup);
      return ((m?.body.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();
    };
    const tap = (id: string, data: string | undefined) =>
      tg.push({ callback_query: { id, data, from: { id: 700, username: 'levi' }, message: { chat: { id: 700, type: 'private' }, message_id: 99 } } });
    try {
      await until(() => bot.status().connected, 'bot conectado');
      tg.message(700, '/top');
      await until(() => keyboardFor(/Grandes partidos/).length > 0, 'lista de grandes partidos');
      const text = tg.messagesTo('700').find((t) => /Grandes partidos/.test(t)) ?? '';
      assert.match(text, /2 semanas antes de la venta/);
      assert.match(text, /1 entrada por cuenta/);
      const clasico = keyboardFor(/Grandes partidos/).find((b) => /Barcelona|Barça/.test(b.text));
      assert.ok(clasico?.callback_data);
      fake.script.push(
        deliver('entregar_evento', {
          name: 'Real Madrid - FC Barcelona',
          date: '2026-10-25',
          time: '16:15',
          venue: 'Estadio Santiago Bernabéu',
          city: 'Madrid',
          url: 'https://www.realmadrid.com/es-ES/entradas/rm-barcelona',
          sales: [{ name: 'Venta general', opensAt: '2026-10-22T10:00' }],
          limit: { perPerson: 2, scope: 'SOCIO', quote: 'Máximo 2 entradas por socio', sourceUrl: 'https://www.realmadrid.com/es-ES/entradas/condiciones' },
          price: null,
          layout: null,
          planImage: null,
          status: 'UPCOMING',
          notes: '',
          sources: [],
        }),
      );
      tap('t1', clasico.callback_data);
      await until(() => keyboardFor(/Real Madrid - FC Barcelona/).some((b) => /Crear/.test(b.text)), 'datos del partido');
      const detailsReq = fake.messageRequests().at(-1);
      assert.match(JSON.stringify(detailsReq?.body.messages), /Web de venta: Real Madrid/, 'se lee con la web del Real Madrid');
      tap('t2', keyboardFor(/Real Madrid - FC Barcelona/).find((b) => /Crear/.test(b.text))?.callback_data);
      await until(() => tg.messagesTo('700').some((t) => /Evento creado/.test(t)), 'evento creado');
      const created = tg.messagesTo('700').find((t) => /Evento creado/.test(t)) ?? '';
      assert.match(created, /Vigilancia desde 2 semanas antes de la venta/);
      assert.match(created, /1 entrada por cuenta/);
      const ev = [...app.runtime.store.events.values()].find((e) => e.name === 'Real Madrid - FC Barcelona');
      assert.equal(ev?.watchDaysBefore, TOP_WATCH_DAYS);
      assert.equal(ev?.perAccountQty, TOP_PER_ACCOUNT);
      assert.equal(ev?.providerId, 'real-madrid');
      // Ya preparado: la lista lo enlaza con su evento.
      assert.equal(top.state().matches.find((m) => m.category === 'CLASICO')?.eventId, ev?.id);
    } finally {
      bot.stop();
      app.runtime.ctx.notifier = null;
      await tg.close();
    }
  });
});

describe('⭐ Grandes partidos enlazados con su evento', () => {
  let dir = '';
  let dataDir = '';
  let app: App;

  before(async () => {
    setLogSilent(true);
    dir = await mkdtemp(path.join(tmpdir(), 'to-top-link-'));
    await writeFixtureVault(dir);
    dataDir = await mkdtemp(path.join(tmpdir(), 'to-top-link-data-'));
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
  });

  after(async () => {
    await app.stop();
    await rm(dir, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
    setLogSilent(false);
  });

  it('un partido sin preparar no sale como «Preparado» por el evento de otro partido del mismo día', async () => {
    const r = await new VaultAuthoring(app).createEvent(
      {
        name: 'Real Madrid - FC Barcelona',
        venueId: 'recinto-test',
        providerId: 'manual',
        startsAt: '2026-10-25T16:15',
        currency: 'EUR',
        limitPerAccount: 4,
        limitPerGroup: 4,
        limitPerOperation: 8,
        limitSemantics: 'PER_HOLDER',
        limitsVerified: false,
        limitsSource: '',
      },
      'prueba',
    );
    assert.ok(r.event);
    const match = (home: string, away: string, time = '21:00') => ({
      name: `${home} - ${away}`,
      home,
      away,
      competition: 'LaLiga',
      category: 'LALIGA',
      importance: 80,
      why: '',
      startsAtLocal: `2026-10-25T${time}`,
      timeTBA: false,
      venue: null,
      city: null,
      country: null,
      ticketUrl: null,
      saleOpensLocal: null,
    });
    const file = path.join(dataDir, 'top-partidos.json');
    const matches = [match('Real Madrid CF', 'FC Barcelona', '16:15'), match('Atlético de Madrid', 'Real Sociedad'), match('Real Betis', 'Real Oviedo')];
    await writeFile(file, JSON.stringify({ at: new Date(NOW).toISOString(), matches, notes: [], cost: null }));
    const top = new TopMatches({ app, ai: {} as never, file, timeZone: TZ });
    await top.load();
    const eventOf = (home: string) => top.state().matches.find((m) => m.home === home)?.eventId;
    assert.equal(eventOf('Real Madrid CF'), r.event?.id, 'el Clásico sí está preparado');
    assert.equal(eventOf('Atlético de Madrid'), null, '«de Madrid» y «Real» no bastan');
    assert.equal(eventOf('Real Betis'), null);
  });
});
