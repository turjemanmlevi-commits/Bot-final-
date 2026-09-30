/**
 * Lo que el dashboard enseña y calcula con las funciones compartidas (y el
 * servidor, cuando es el mismo dato):
 *
 * - Fases de venta: se eligen por posición (dos pueden llamarse igual) y el
 *   aviso de «la web dice N por persona» mira también «Por grupo».
 * - «📥 Enviar a la sala» desde la portada de una web: no hay evento.
 * - Vigilancia: desde la misma hora de reloj aunque cruce el cambio de hora.
 * - Motivo de pausa y de fin legibles (no códigos internos).
 * - Operación de «1 por cuenta» con más cuentas que el tope por operación.
 * - Errores de Claude sin el JSON crudo de la API.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  aiEventDraft,
  END_REASON_LABEL,
  limitAbovePhase,
  parsePageCapture,
  pausedReasonText,
  perAccountRequestedQty,
  TOP_PER_ACCOUNT,
  watchStartMs,
  type AiEventDetails,
  type ImportContext,
  type PageCapture,
} from '@to/shared';
import { createApp, type App } from '../app';
import { AiError, ClaudeControl } from '../ai/claude';
import { FeedControl } from '../feeds/control';
import { EventWatcher } from '../feeds/watcher';
import { writeFixtureVault } from '../gates/fixtures';
import { createHarness, manualConfig, simConfig, SIM_ACCOUNTS } from '../gates/harness';
import { MemoryDriver } from '../store/drivers';
import type { Clock } from '../util/clock';
import { SeqIdGen } from '../util/ids';
import { setLogSilent } from '../util/log';
import { iso } from '../util/time';
import { AI_KEY, FakeAnthropic } from './fake-anthropic';

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

function details(sales: AiEventDetails['sales']): AiEventDetails {
  return {
    name: 'Prueba Duplicado',
    startsAtLocal: '2026-12-12T21:00',
    timeTBA: false,
    venue: 'Movistar Arena',
    city: 'Madrid',
    url: 'https://www.ticketmaster.es/event/duplicado',
    seller: 'Ticketmaster España',
    urlWarning: null,
    sales,
    limit: { perPerson: 4, semantics: 'PER_HOLDER', quote: 'Máximo 4 entradas por cuenta', sourceUrl: 'https://www.ticketmaster.es/event/duplicado', official: true },
    price: null,
    layout: null,
    planImageUrl: null,
    status: 'UPCOMING',
    notes: '',
    sources: [],
    vaultVenueId: null,
    cost: { usd: 0, searches: 0, fetches: 0, inputTokens: 0, outputTokens: 0, seconds: 0 },
    cached: false,
  };
}

describe('fases de venta en el formulario del evento', () => {
  const opts = { today: '2026-10-01', nowLocal: '2026-10-01T10:00' };
  const d = details([
    { name: 'Venta socios', opensAtLocal: '2026-11-01T10:00', limit: 1 },
    { name: 'Venta socios', opensAtLocal: '2026-11-02T10:00', limit: 2 },
    { name: 'Venta general', opensAtLocal: '2026-11-05T10:00', limit: 4 },
  ]);

  it('dos fases con el mismo nombre: se usa la elegida (por posición), con su apertura y su límite', () => {
    const second = aiEventDraft(d, { ...opts, saleIndex: 1 });
    assert.equal(second.onSaleAt, '2026-11-02T10:00');
    assert.equal(second.limit?.perAccount, 2);
    const first = aiEventDraft(d, { ...opts, saleIndex: 0 });
    assert.equal(first.onSaleAt, '2026-11-01T10:00');
    assert.equal(first.limit?.perAccount, 1);
    // Sin fase (null) no hay apertura; sin decir nada, la venta general próxima (como antes).
    assert.equal(aiEventDraft(d, { ...opts, saleIndex: null }).onSaleAt, null);
    assert.equal(aiEventDraft(d, opts).onSaleAt, '2026-11-05T10:00');
    // La nota dice la apertura elegida.
    assert.match(second.notes, /Apertura elegida: Venta socios\./);
    assert.match(aiEventDraft(d, opts).notes, /Apertura elegida: Venta general\./);
  });

  it('«la web dice 1 por persona»: también avisa si «Por grupo» deja comprar más a un titular', () => {
    assert.deepEqual(limitAbovePhase({ perAccount: 1, perGroup: 2, semantics: 'PER_HOLDER' }, 1), { field: 'perGroup', value: 2 });
    assert.deepEqual(limitAbovePhase({ perAccount: 2, perGroup: 2, semantics: 'PER_HOLDER' }, 1), { field: 'perAccount', value: 2 });
    assert.equal(limitAbovePhase({ perAccount: 1, perGroup: 1, semantics: 'PER_HOLDER' }, 1), null);
    // Por cuenta, el grupo es la propia cuenta: «Por grupo» no cuenta.
    assert.equal(limitAbovePhase({ perAccount: 1, perGroup: 2, semantics: 'PER_ACCOUNT' }, 1), null);
    // La fase no dice límite.
    assert.equal(limitAbovePhase({ perAccount: 4, perGroup: 8, semantics: 'PER_HOLDER' }, null), null);
  });
});

describe('«📥 Enviar a la sala» desde la portada de la web', () => {
  const ctx: ImportContext = {
    timeZone: TZ,
    venues: [{ venueId: 'movistar-arena', name: 'Movistar Arena', city: 'Madrid', aliases: [] }],
    providers: [
      { providerId: 'ticketmaster', url: 'https://www.ticketmaster.es' },
      { providerId: 'entradas-com', url: 'https://www.entradas.com' },
      { providerId: 'real-madrid', url: 'https://www.realmadrid.com/es-ES/entradas' },
    ],
  };
  const capture = (p: Partial<PageCapture>): PageCapture => ({
    v: 1,
    url: 'https://example.com/',
    canonical: null,
    title: '',
    h1: null,
    meta: {},
    ld: [],
    times: [],
    lines: [],
    selection: null,
    at: '2026-09-29T08:00:00.000Z',
    ...p,
  });

  it('el nombre de la web o su dominio no es el nombre de un evento', () => {
    const tm = parsePageCapture(
      capture({ url: 'https://www.ticketmaster.es/', title: 'Ticketmaster España | Entradas para conciertos, deportes y teatro', meta: { 'og:title': 'Ticketmaster España' } }),
      ctx,
    );
    assert.equal(tm.events[0]?.name, null);
    const ec = parsePageCapture(capture({ url: 'https://www.entradas.com/', title: 'entradas.com | Entradas para conciertos' }), ctx);
    assert.equal(ec.events[0]?.name, null);
    const rm = parsePageCapture(capture({ url: 'https://www.realmadrid.com/es-ES', title: 'Real Madrid CF | Web Oficial del Real Madrid' }), ctx);
    assert.equal(rm.events[0]?.name, null);
  });

  it('en la portada sin fecha no hay evento; una página de evento (o una portada con fecha) sí', () => {
    const home = parsePageCapture(capture({ url: 'https://www.festival-prueba.example/', title: 'Las mejores entradas del verano' }), ctx);
    assert.equal(home.events[0]?.name, null);
    const page = parsePageCapture(capture({ url: 'https://www.ticketmaster.es/event/x/1', title: 'Entradas Morat - Los Estadios 2026 | Ticketmaster España' }), ctx);
    assert.equal(page.events[0]?.name, 'Morat - Los Estadios 2026');
    const single = parsePageCapture(capture({ url: 'https://www.festival-prueba.example/', title: 'Festival de Prueba 2027', lines: ['Sábado 10 de julio de 2027 · 18:00'] }), ctx);
    assert.equal(single.events[0]?.name, 'Festival de Prueba 2027');
  });
});

describe('vigilancia a la misma hora de reloj', () => {
  let dir = '';
  let app: App;
  let watcher: EventWatcher;

  before(async () => {
    setLogSilent(true);
    dir = await mkdtemp(path.join(tmpdir(), 'to-dash-watch-'));
    await writeFixtureVault(dir);
    await note(dir, '10 Recintos/Anfield/Anfield.md', 'type: venue\nid: anfield\nname: Anfield\ncity: Liverpool\nsource: prueba');
    await note(dir, '10 Recintos/Anfield/Zonas/Kop.md', 'type: zone');
    await note(dir, '10 Recintos/Anfield/Secciones/Kop Grada.md', 'type: section\nzone: "[[Kop]]"\nkind: SEATED');
    await note(
      dir,
      '20 Eventos/Liverpool.md',
      [
        'type: event',
        'id: evt-liverpool',
        'name: Liverpool FC - Atlético de Madrid',
        'venue: "[[Anfield]]"',
        'provider: "[[Manual]]"',
        'providerEventRef: LIV-ATM',
        'startsAt: 2026-12-09T21:00',
        // Venta el 28 de octubre (ya en horario de invierno); 14 días antes aún es horario de verano.
        'onSaleAt: 2026-10-28T10:00',
        'currency: EUR',
        'limitPerAccount: 1',
        'limitPerGroup: 1',
        'limitPerOperation: 8',
        'limitSemantics: PER_HOLDER',
        'limitsVerified: true',
        'limitsSource: prueba',
        'watchDaysBefore: 14',
      ].join('\n'),
    );
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    assert.deepEqual(app.runtime.store.vaultReport?.errors, []);
    const feeds = new FeedControl({ runtime: app.runtime, timeZone: TZ, envFile: null, fast: true });
    watcher = new EventWatcher({ app, feeds, timeZone: TZ });
  });

  after(async () => {
    watcher.stop();
    await app.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('«2 semanas antes» de una venta a las 10:00 empieza a las 10:00 aunque en medio cambie la hora', async () => {
    await watcher.tick();
    const w = app.runtime.store.watches.get('evt-liverpool');
    assert.ok(w);
    assert.equal(w.state, 'WAITING');
    assert.equal(w.anchor, '2026-10-28T09:00:00.000Z', '10:00 en Madrid (CET)');
    assert.equal(w.from, '2026-10-14T08:00:00.000Z', '10:00 en Madrid (CEST), no las 11:00');
  });

  it('lo mismo en primavera, y sin cambio de hora son días de 24 h', () => {
    // 1 de abril de 2027 a las 10:00 (CEST) → 18 de marzo a las 10:00 (CET).
    assert.equal(iso(watchStartMs(Date.parse('2027-04-01T08:00:00Z'), 14, TZ)), '2027-03-18T09:00:00.000Z');
    assert.equal(iso(watchStartMs(Date.parse('2026-10-20T08:00:00Z'), 2, TZ)), '2026-10-18T08:00:00.000Z');
    assert.equal(iso(watchStartMs(Date.parse('2026-10-20T08:00:00Z'), 0, TZ)), '2026-10-20T08:00:00.000Z');
  });
});

describe('motivos de pausa y de fin de una operación', () => {
  let dir = '';
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'to-dash-ops-'));
    await writeFixtureVault(dir);
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parada con el kill switch de la operación: motivo en castellano, con su nombre y qué hacer; al acabar la ventana, por qué terminó', async () => {
    const h = await createHarness(dir, { seed: 7 });
    try {
      const rt = h.app.runtime;
      const accounts = SIM_ACCOUNTS.map((a) => rt.ctx.accounts.create(a, 't'));
      const op = rt.ctx.ops.create(simConfig(accounts.map((a) => a.id), h.clock.now(), { name: 'Demo de la sala', requestedQty: 12, simulation: { scenarioId: 'alta-demanda', seed: 7 } }), 't');
      await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      await rt.ctx.ops.command(op.id, { command: 'arm' }, 't');
      h.humanSolvesChallenges();
      await h.clock.runUntil(() => rt.ctx.ops.get(op.id).state === 'RUNNING', 120_000);
      rt.ctx.safety.setKillSwitch('OPERATION', op.id, true, 'prueba', 't');
      await h.clock.advance(100);
      const s = rt.ctx.ops.summaries().find((x) => x.id === op.id);
      assert.equal(s?.state, 'PAUSED');
      assert.equal(s?.pausedReason, `KILL_SWITCH operation:${op.id}`, 'lo que guarda el servidor');
      const text = pausedReasonText(s?.pausedReason ?? '', (scope, id) => (scope === 'OPERATION' ? (rt.ctx.ops.summaries().find((x) => x.id === id)?.name ?? null) : null));
      assert.equal(text, 'Parada de la operación «Demo de la sala» (kill switch): suéltala en Seguridad y pulsa «Reanudar».');
      assert.doesNotMatch(text, /KILL_SWITCH|op_/);

      await h.clock.runUntil(() => rt.ctx.ops.get(op.id).state === 'ENDED', 20 * 60_000);
      const ended = rt.ctx.ops.summaries().find((x) => x.id === op.id);
      assert.equal(ended?.endReason, 'RUN_WINDOW_ELAPSED');
      assert.equal(END_REASON_LABEL[ended.endReason], 'se agotó la ventana');
    } finally {
      await h.stop();
    }
  });

  it('los demás códigos también se explican; lo que escribe una persona se deja tal cual', () => {
    assert.match(pausedReasonText('KILL_SWITCH global'), /^Parada global/);
    assert.match(pausedReasonText('KILL_SWITCH provider:real-madrid', () => 'Real Madrid'), /web de venta «Real Madrid»/);
    assert.match(pausedReasonText('KILL_SWITCH account:acc_1'), /^Parada de la cuenta \(kill switch\)/);
    assert.match(pausedReasonText('SCHEMA_DRIFT'), /cambió el formato.*reinicia su circuito en Seguridad/);
    assert.match(pausedReasonText('JOURNAL_DEGRADED'), /journal/);
    assert.match(pausedReasonText('ARTEFACTO_NO_DISPONIBLE'), /Recintos · vault/);
    assert.match(pausedReasonText('RECOVERY'), /Reinicio del servidor/);
    assert.equal(pausedReasonText('Pausa manual'), 'Pausa manual');
    assert.equal(pausedReasonText('Voy a revisar los precios'), 'Voy a revisar los precios');
  });
});

describe('operación de «1 por cuenta» con más cuentas que el tope por operación', () => {
  let dir = '';
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'to-dash-top-'));
    await writeFixtureVault(dir);
    await note(
      dir,
      '20 Eventos/Gran partido.md',
      [
        'type: event',
        'id: evt-gran-partido',
        'name: Gran partido',
        'venue: "[[Recinto Test]]"',
        'provider: "[[Manual]]"',
        'providerEventRef: TEST-GRAN',
        'startsAt: 2027-01-01T21:00:00Z',
        'currency: EUR',
        'limitPerAccount: 4',
        'limitPerGroup: 4',
        'limitPerOperation: 8',
        'limitSemantics: PER_HOLDER',
        'limitsVerified: true',
        'limitsSource: prueba',
        `perAccountQty: ${TOP_PER_ACCOUNT}`,
      ].join('\n'),
    );
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('con 10 cuentas y un tope de 8 se piden 8 y la operación se puede validar', async () => {
    assert.equal(perAccountRequestedQty(10, 1, 8), 8);
    assert.equal(perAccountRequestedQty(6, 1, 8), 6);
    assert.equal(perAccountRequestedQty(5, 2, 8), 8);
    assert.equal(perAccountRequestedQty(0, 1, 8), 1);
    const h = await createHarness(dir);
    try {
      const rt = h.app.runtime;
      const ev = rt.store.events.get('evt-gran-partido');
      assert.equal(ev?.perAccountQty, 1);
      const accounts = Array.from({ length: 10 }, (_, i) => rt.ctx.accounts.create({ label: `Cuenta ${i + 1}`, providerId: 'manual', holderRef: `persona${i + 1}`, verification: 'VERIFIED' }, 't'));
      const base = manualConfig(
        accounts.map((a) => a.id),
        h.clock.now(),
      );
      // Lo que monta el formulario: todas las cuentas de la web, 1 por cuenta.
      const config = {
        ...base,
        eventId: 'evt-gran-partido',
        requestedQty: perAccountRequestedQty(accounts.length, ev?.perAccountQty ?? 1, ev?.limits.perOperation ?? 0),
        budget: 400_000,
        preferences: { ...base.preferences, targets: [], requireContiguous: false, minGroupSize: 1, maxPerAccount: ev?.perAccountQty ?? null },
      };
      const op = rt.ctx.ops.create(config, 't');
      const v = await rt.ctx.ops.command(op.id, { command: 'validate' }, 't');
      assert.ok(v.ok, JSON.stringify(v.validation?.issues));
      assert.equal(rt.ctx.ops.get(op.id).config.requestedQty, 8);
      // Pidiendo cuentas × 1 (lo de antes), el servidor lo rechaza.
      const before = rt.ctx.ops.create({ ...config, requestedQty: accounts.length }, 't');
      const bad = await rt.ctx.ops.command(before.id, { command: 'validate' }, 't');
      assert.equal(bad.ok, false);
      assert.ok(bad.validation?.issues.some((i) => i.code === 'QTY_ABOVE_OPERATION_LIMIT'));
    } finally {
      await h.stop();
    }
  });
});

describe('errores de Claude legibles', () => {
  let fake: FakeAnthropic;
  let dir = '';
  let app: App;
  let ai: ClaudeControl;

  before(async () => {
    setLogSilent(true);
    fake = new FakeAnthropic();
    const base = await fake.listen();
    dir = await mkdtemp(path.join(tmpdir(), 'to-dash-ai-'));
    await writeFixtureVault(dir);
    await note(dir, '30 Proveedores/Real Madrid.md', 'type: provider\nid: real-madrid\nname: Real Madrid\nmode: MANUAL_ASSIST\nurl: https://www.realmadrid.com/es-ES/entradas\nauthorizedCapabilities: []');
    app = await createApp({ driver: new MemoryDriver(), vaultDir: dir, timeZone: TZ, publicBaseUrl: 'http://x', clock: new ManualClock(NOW), ids: new SeqIdGen() });
    ai = new ClaudeControl({ runtime: app.runtime, timeZone: TZ, envFile: null, baseURL: base }, { apiKey: AI_KEY });
  });

  after(async () => {
    await app.stop();
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('si la API rechaza la consulta, se enseña su mensaje, no el JSON de la respuesta', async () => {
    fake.script.push({ status: 400, type: 'invalid_request_error', message: 'max_tokens: 64000 > 32000, which is the maximum allowed' });
    await assert.rejects(ai.findEvents({ providerId: 'real-madrid', days: 9, fresh: true }), (err: unknown) => {
      assert.ok(err instanceof AiError);
      assert.equal(err.code, 'BAD_REQUEST');
      assert.equal(err.message, 'Claude ha rechazado la consulta: max_tokens: 64000 > 32000, which is the maximum allowed');
      assert.doesNotMatch(err.message, /\{|"type"|invalid_request_error|^400/);
      return true;
    });
  });
});
