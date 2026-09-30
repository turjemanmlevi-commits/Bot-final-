/**
 * Prueba real con el Real Madrid en un clic (dashboard o /prueba en Telegram).
 *
 * Usa las cuentas del Real Madrid que ya hay en «Cuentas» (no crea cuentas de
 * mentira), elige un partido de prueba (etiqueta «prueba») que esté a la venta y
 * en el que a esas cuentas les quede cupo, y crea, valida y arma una operación de
 * 1 entrada por cuenta que abre en unos minutos. Al armar llega por Telegram el
 * plan con «✅ Sesión lista»; a la hora, la tarea de compra. La sala no entra en
 * la web oficial: cada persona añade la entrada al carrito con su cuenta.
 */

import type { Account, CatalogEvent, Id, OperationConfig, OperationState } from '@to/shared';
import { eventUsage, groupKeyFor } from '../domain/limits';
import { accountEligible } from '../domain/validation';
import { iso } from '../util/time';
import type { Runtime } from './runtime';

export const REAL_TEST_PROVIDER = 'real-madrid';
export const REAL_TEST_PREFIX = 'Prueba Real Madrid · ';
/** Precio máximo por entrada de la prueba (con gastos): cubre la entrada general de los partidos de prueba. */
export const REAL_TEST_MAX_PRICE = 6_000;
const MAX_ACCOUNTS = 10;

/** Estados en los que una operación aún puede comprar: retiene su parte del cupo del evento. */
const BUYING = new Set<OperationState>(['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING', 'CART_SECURED']);
/** Una prueba anterior en estos estados sigue viva: hay que pararla antes de empezar otra. */
const LIVE = new Set<OperationState>(['ARMED', 'FROZEN', 'RUNNING', 'PAUSED', 'RECOVERING']);

export interface RealTestResult {
  operationId: Id;
  eventId: Id;
  eventName: string;
  accounts: string[];
  t0: string;
  telegram: boolean;
  message: string;
}

const isTest = (name: string) => name.startsWith(REAL_TEST_PREFIX);

/** Partidos de prueba del Real Madrid: primero los que ya están a la venta, después por fecha. */
function testEvents(runtime: Runtime, now: number): CatalogEvent[] {
  const onSale = (e: CatalogEvent) => e.onSaleAt === null || Date.parse(e.onSaleAt) <= now;
  return [...runtime.store.events.values()]
    .filter((e) => e.providerId === REAL_TEST_PROVIDER && e.tags.includes('prueba') && e.limits.verified && Date.parse(e.startsAt) > now)
    .sort((a, b) => Number(onSale(b)) - Number(onSale(a)) || a.startsAt.localeCompare(b.startsAt));
}

/** Cuentas a las que les queda al menos 1 entrada de este evento (límite por cuenta y por grupo). */
function withQuota(runtime: Runtime, event: CatalogEvent, accounts: Account[]): Account[] {
  const { store } = runtime;
  const { limits } = event;
  const ops = [...store.operations.values()].filter((o) => o.config.eventId === event.id);
  const usage = eventUsage({
    semantics: limits.semantics,
    accounts: store.accounts,
    operations: ops.map((o) => ({ id: o.id, name: o.config.name, allocation: BUYING.has(o.state) ? (store.allocations.get(o.id) ?? null) : null })),
    carts: store.carts.values(),
    claims: store.claims.values(),
  });
  const takenByGroup = new Map<string, number>();
  const out: Account[] = [];
  for (const a of accounts) {
    const key = groupKeyFor(a, limits.semantics);
    if (key === null) continue;
    const accountLeft = limits.perAccount - (usage.perAccount.get(a.id) ?? 0);
    const groupLeft = limits.perGroup - (usage.perGroup.get(key) ?? 0) - (takenByGroup.get(key) ?? 0);
    if (accountLeft < 1 || groupLeft < 1) continue;
    takenByGroup.set(key, (takenByGroup.get(key) ?? 0) + 1);
    out.push(a);
  }
  return out.slice(0, Math.min(MAX_ACCOUNTS, limits.perOperation));
}

export async function seedRealTest(
  runtime: Runtime,
  opts: { startInSeconds?: number; actor?: string } = {},
): Promise<RealTestResult> {
  const actor = opts.actor ?? 'prueba';
  const { store, ctx } = runtime;
  const now = ctx.now();

  const mine = [...store.accounts.values()].filter((a) => a.providerId === REAL_TEST_PROVIDER && a.enabled && a.verification === 'VERIFIED');
  if (mine.length === 0) {
    throw new Error('No hay ninguna cuenta del Real Madrid lista: en «Cuentas» crea la tuya (proveedor Real Madrid, verificada) y vuelve a pulsar.');
  }

  // Una prueba anterior que sigue viva se para primero; una ya terminada (o con todo en el
  // carrito) se cierra sola: sus carritos siguen en «Carritos», con sus avisos, para pagar o liberar.
  for (const r of [...store.operations.values()]) {
    if (!isTest(r.config.name)) continue;
    if (LIVE.has(r.state)) {
      throw new Error(`Ya hay una prueba en marcha: «${r.config.name}». Párala en Operaciones (o espera a que acabe) antes de empezar otra.`);
    }
    if (r.state === 'ENDED' || r.state === 'CART_SECURED') await ctx.ops.command(r.id, { command: 'close', confirm: true }, actor);
    else if (r.state === 'DRAFT' || r.state === 'VALIDATED') await ctx.ops.command(r.id, { command: 'cancel', reason: 'Sustituida por una prueba nueva' }, actor);
  }

  // Las cuentas que están en otra operación (una compra de verdad) no se tocan.
  const busy: string[] = [];
  const free = mine.filter((a) => {
    const current = store.accounts.get(a.id);
    if (!current?.leasedBy) return true;
    const op = store.operations.get(current.leasedBy);
    busy.push(`«${a.label}» está en «${op?.config.name ?? current.leasedBy}»`);
    return false;
  });
  if (free.length === 0) {
    throw new Error(`Tus cuentas del Real Madrid están ocupadas: ${busy.join('; ')}. Ciérrala en Operaciones y vuelve a pulsar.`);
  }

  const events = testEvents(runtime, now);
  if (events.length === 0) {
    throw new Error('No hay partidos de prueba del Real Madrid por jugar en el vault (20 Eventos, etiqueta «prueba»). Actualiza la sala para tener los nuevos.');
  }
  if (!events.some((e) => free.some((a) => accountEligible(a, e)))) {
    throw new Error('Tus cuentas del Real Madrid no son elegibles para los partidos de prueba: en «Cuentas» → editar, pon «*» en «Elegible para» y vuelve a pulsar.');
  }
  let event: CatalogEvent | null = null;
  let accounts: Account[] = [];
  for (const e of events) {
    const ok = withQuota(runtime, e, free.filter((a) => accountEligible(a, e)));
    if (ok.length > accounts.length) {
      event = e;
      accounts = ok;
    }
    if (accounts.length === Math.min(free.length, MAX_ACCOUNTS)) break;
  }
  if (!event || accounts.length === 0) {
    throw new Error(
      'A tus cuentas no les queda cupo en ningún partido de prueba (1 entrada por persona): en «Carritos», libera los carritos de pruebas anteriores que no pagasteis y vuelve a pulsar.',
    );
  }

  const startIn = Math.max(20, opts.startInSeconds ?? 120);
  const t0 = iso(now + startIn * 1000);
  const qty = accounts.length;
  const config: OperationConfig = {
    name: `${REAL_TEST_PREFIX}${event.name}`,
    eventId: event.id,
    providerId: event.providerId,
    t0,
    runWindowMinutes: 30,
    freezeLeadSeconds: Math.min(30, Math.floor(startIn / 2)),
    requestedQty: qty,
    currency: event.currency,
    maxUnitPrice: REAL_TEST_MAX_PRICE,
    budget: REAL_TEST_MAX_PRICE * qty,
    preferences: {
      targets: event.preferredTargets,
      excludeSections: [],
      requireContiguous: false,
      minGroupSize: 1,
      allowStanding: true,
      allowObstructed: false,
      allowAccessible: false,
      maxAmbiguity: 0.3,
      maxPerAccount: 1,
    },
    accountIds: accounts.map((a) => a.id),
    cartExpiryAlertsSeconds: [300, 60],
  };

  const op = ctx.ops.create(config, actor);
  // Si no valida o no se arma, no se deja una operación huérfana en borrador.
  const validated = await ctx.ops.command(op.id, { command: 'validate' }, actor);
  if (!validated.ok) {
    await ctx.ops.command(op.id, { command: 'cancel', reason: 'La prueba no valida' }, actor);
    const why = validated.validation?.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message).join(' · ');
    throw new Error(`La prueba no valida: ${why || validated.message}`);
  }
  const armed = await ctx.ops.command(op.id, { command: 'arm' }, actor);
  if (!armed.ok) {
    await ctx.ops.command(op.id, { command: 'cancel', reason: 'La prueba no se puede armar' }, actor);
    throw new Error(`La prueba no se puede armar: ${armed.message}`);
  }

  const tg = ctx.telegramStatus?.() ?? null;
  // Solo si el bot está conectado: con un chat en la cuenta pero sin bot no llega nada.
  const connected = tg ? tg.connected : Boolean(ctx.notifier?.connected);
  const mainChat = tg ? tg.mainChatConfigured : connected;
  const telegram = connected && (mainChat || accounts.some((a) => a.telegramChatId));
  const clock = new Intl.DateTimeFormat('es-ES', { timeZone: ctx.cfg.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(t0));
  const skipped = mine.length > accounts.length ? ` (${mine.length - accounts.length} sin usar: ocupadas o sin cupo)` : '';
  const notYet =
    event.onSaleAt && Date.parse(event.onSaleAt) > now
      ? `Ojo: la venta general de este partido abre el ${new Intl.DateTimeFormat('es-ES', { timeZone: ctx.cfg.timeZone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(event.onSaleAt))}; hasta entonces la web puede no dejarte añadirla. `
      : '';
  const message =
    `Prueba armada: ${event.name}, ${qty} ${qty === 1 ? 'entrada' : 'entradas'} (1 por cuenta: ${accounts.map((a) => a.label).join(', ')}${skipped}). ` +
    `La venta de prueba abre a las ${clock}. ` +
    notYet +
    (telegram
      ? 'Te llega ahora el plan por Telegram: entra en realmadrid.com con tu cuenta y pulsa «✅ Sesión lista».'
      : 'Telegram no está conectado: las tareas solo salen en «Tareas humanas» (conéctalo en Ajustes · Telegram).');
  return { operationId: op.id, eventId: event.id, eventName: event.name, accounts: accounts.map((a) => a.label), t0, telegram, message };
}
