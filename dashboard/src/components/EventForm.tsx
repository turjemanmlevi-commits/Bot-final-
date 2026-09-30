import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import {
  aiDefaultSale,
  aiEventDraft,
  aiLayoutText,
  aiSaleZonesText,
  AI_STATUS_LABEL,
  EventNoteInputSchema,
  guessVenueLayout,
  limitAbovePhase,
  LIMIT_SEMANTICS,
  LIMIT_SEMANTICS_LABEL,
  LOCAL_DATETIME_RE,
  TOP_PER_ACCOUNT,
  TOP_WATCH_DAYS,
  watchStartMs,
  type AiEventDetails,
  type AiEventSummary,
  type AiSaleZone,
  type CatalogEvent,
  type EventNoteInput,
  type FeedEvent,
  type FeedId,
  type FeedSale,
  type ImportedEvent,
  type LimitSemantics,
  type PageImport,
  type ProviderAuthorization,
  type ProviderMode,
  type TopMatch,
  type VaultIssue,
  type VenueArtifact,
} from '@to/shared';
import { Api, ApiError } from '../lib/api';
import { fmtRel } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { ClaudeEventPicker, fmtLocalDate } from './ClaudeEventPicker';
import { Icon } from './Icon';
import { EventSourcePanel, fmtMadrid } from './OfficialEventPicker';
import { SeatPicker, useVenueArtifact, type PlanState } from './SeatPicker';
import { Callout, Card, Pill } from './ui';

// ---------------------------------------------------------------------------
// Fechas: el vault guarda la hora local de Madrid ("2026-09-30T18:05").
// ---------------------------------------------------------------------------

const MADRID_TZ = 'Europe/Madrid';

const madridFmt = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Instante (ISO o epoch) → "AAAA-MM-DDTHH:mm" en hora de Madrid, para <input type="datetime-local">. */
function madridLocal(value: string | number): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = madridFmt.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** "AAAA-MM-DDTHH:mm" en hora de Madrid → epoch (ms). Solo para los avisos del formulario. */
function madridEpoch(local: string): number | null {
  if (!LOCAL_DATETIME_RE.test(local)) return null;
  const asUtc = Date.parse(`${local}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  const offsetAt = (t: number) => Date.parse(`${madridLocal(t)}:00Z`) - t;
  const first = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(first);
  return Number.isNaN(second) ? null : second;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return MADRID_TZ;
  }
}

// ---------------------------------------------------------------------------
// Estado del formulario
// ---------------------------------------------------------------------------

type Field = keyof EventNoteInput;
type Errors = Partial<Record<Field, string>>;

interface FormState {
  name: string;
  venueId: string;
  providerId: string;
  url: string;
  providerEventRef: string;
  startsAt: string;
  onSaleAt: string;
  currency: string;
  limitPerAccount: string;
  limitPerGroup: string;
  limitPerOperation: string;
  limitSemantics: LimitSemantics;
  limitsVerified: boolean;
  limitsSource: string;
  limitsNotes: string;
  notes: string;
  /** Evento elegido de una fuente oficial (se vigila en ella). */
  officialFeed: FeedId | null;
  officialId: string;
  officialSale: string | null;
  /** Días antes de la venta desde los que se vigila ('0' = no). */
  watchDaysBefore: string;
  /** Recinto que no está en la sala: se crea al guardar (venueId = NEW_VENUE). */
  newVenue: { name: string; city: string | null } | null;
  /** Dónde queréis las entradas: hasta 3 zonas, en orden de preferencia. */
  seats: string[];
  /** Plano oficial (imagen tal cual se ve al comprar) y dónde está cada zona en él. */
  plan: PlanState | null;
  /** Entradas por cuenta en la compra ('' = hasta el límite oficial; '1' en los grandes partidos). */
  perAccountQty: string;
  /** Cómo está estructurada la venta de este evento (de Claude). */
  saleZones: AiSaleZone[];
}

/** Valor del selector de recinto para «recinto nuevo, se crea al guardar». */
const NEW_VENUE = '__nuevo__';

/** Opciones de «Vigilar desde». */
const WATCH_OPTIONS: Array<[string, string]> = [
  ['0', 'No vigilar'],
  ['1', '1 día antes'],
  ['2', '2 días antes'],
  ['3', '3 días antes'],
  ['7', '1 semana antes'],
  ['14', '2 semanas antes'],
];

const FIELDS: readonly Field[] = [
  'name',
  'venueId',
  'providerId',
  'url',
  'providerEventRef',
  'startsAt',
  'onSaleAt',
  'currency',
  'limitPerAccount',
  'limitPerGroup',
  'limitPerOperation',
  'limitSemantics',
  'limitsVerified',
  'limitsSource',
  'limitsNotes',
  'notes',
  'officialFeed',
  'officialId',
  'officialSale',
  'watchDaysBefore',
  'preferredTargets',
  'planImage',
  'planPoints',
  'perAccountQty',
  'saleZones',
];

const MODE_LABEL: Record<ProviderMode, string> = {
  MANUAL_ASSIST: 'asistencia manual',
  SIMULATED: 'simulado (ensayos)',
  AUTHORIZED_API: 'API autorizada',
};

const SEMANTICS_HELP: Record<LimitSemantics, string> = {
  PER_ACCOUNT: 'Cada cuenta tiene su propio cupo.',
  PER_HOLDER: 'Varias cuentas de la misma persona comparten cupo (lo normal en Ticketmaster y en el Real Madrid).',
  PER_HOUSEHOLD: 'Las cuentas del mismo hogar comparten cupo.',
  PER_PAYMENT_METHOD: 'Las cuentas que pagan con la misma tarjeta comparten cupo.',
  UNKNOWN: 'No se sabe cómo cuenta: no se podrá armar ninguna operación.',
};

/** Quién comparte el cupo de «Por grupo». */
const GROUP_NOUN: Record<LimitSemantics, string> = {
  PER_ACCOUNT: 'cuenta',
  PER_HOLDER: 'titular',
  PER_HOUSEHOLD: 'hogar',
  PER_PAYMENT_METHOD: 'tarjeta',
  UNKNOWN: 'grupo',
};

const GROUP_HINT: Record<LimitSemantics, string> = {
  PER_ACCOUNT: 'Con «Por cuenta» el grupo es la propia cuenta.',
  PER_HOLDER: 'Máximo por titular, sumando todas sus cuentas.',
  PER_HOUSEHOLD: 'Máximo por hogar, sumando todas sus cuentas.',
  PER_PAYMENT_METHOD: 'Máximo por tarjeta, sumando las cuentas que la usan.',
  UNKNOWN: 'Máximo por grupo (sin saber cómo cuenta no se puede armar).',
};

/** Mensajes en español para los campos cuyo esquema no los trae. */
const FIXED_MSG: Errors = {
  currency: 'Tres letras, p. ej. EUR',
  limitPerAccount: 'Pon un número entero entre 1 y 100',
  limitPerGroup: 'Pon un número entero entre 1 y 100',
  limitPerOperation: 'Pon un número entero entre 1 y 1000',
  limitSemantics: 'Elige cómo cuenta el límite',
};

function issueMessage(field: Field, code: string, message: string): string {
  if (code === 'custom') return message;
  const fixed = FIXED_MSG[field];
  if (fixed) return fixed;
  if (code === 'too_big') return 'Texto demasiado largo';
  return message;
}

/** El servidor responde 400 con "campo: mensaje; campo: mensaje". */
function parseServerErrors(message: string): Errors {
  const out: Errors = {};
  for (const part of message.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const msg = part.slice(i + 1).trim();
    const field = FIELDS.find((f) => f === key);
    if (field && msg && !out[field]) out[field] = msg;
  }
  return out;
}

function sortProviders(list: ProviderAuthorization[]): ProviderAuthorization[] {
  return [...list].sort((a, b) => Number(a.mode === 'SIMULATED') - Number(b.mode === 'SIMULATED') || a.name.localeCompare(b.name, 'es'));
}

function defaultProviderId(list: ProviderAuthorization[]): string {
  return (list.find((p) => p.providerId === 'real-madrid') ?? list.find((p) => p.mode !== 'SIMULATED'))?.providerId ?? '';
}

function blank(providerId: string): FormState {
  return {
    name: '',
    venueId: '',
    providerId,
    url: '',
    providerEventRef: '',
    startsAt: '',
    onSaleAt: '',
    currency: 'EUR',
    limitPerAccount: '4',
    limitPerGroup: '4',
    limitPerOperation: '8',
    limitSemantics: 'PER_HOLDER',
    limitsVerified: false,
    limitsSource: '',
    limitsNotes: '',
    notes: '',
    officialFeed: null,
    officialId: '',
    officialSale: null,
    watchDaysBefore: '2',
    newVenue: null,
    seats: [],
    plan: null,
    perAccountQty: '',
    saleZones: [],
  };
}

function fromEvent(e: CatalogEvent): FormState {
  return {
    name: e.name,
    venueId: e.venueId,
    providerId: e.providerId,
    url: e.url ?? '',
    providerEventRef: e.providerEventRef,
    startsAt: madridLocal(e.startsAt),
    onSaleAt: e.onSaleAt ? madridLocal(e.onSaleAt) : '',
    currency: e.currency,
    limitPerAccount: String(e.limits.perAccount),
    limitPerGroup: String(e.limits.perGroup),
    limitPerOperation: String(e.limits.perOperation),
    limitSemantics: e.limits.semantics,
    limitsVerified: e.limits.verified,
    limitsSource: e.limits.source,
    limitsNotes: e.limits.notes,
    notes: '',
    officialFeed: e.officialFeed ?? null,
    officialId: e.officialId ?? '',
    officialSale: e.officialSale ?? null,
    watchDaysBefore: String(e.watchDaysBefore ?? 0),
    newVenue: null,
    seats: e.preferredTargets ?? [],
    plan: e.seatMap ?? null,
    perAccountQty: e.perAccountQty ? String(e.perAccountQty) : '',
    saleZones: e.saleZones ?? [],
  };
}

/** Hoy en Madrid (AAAA-MM-DD), para citar de cuándo es el dato oficial. */
function madridToday(): string {
  return madridLocal(Date.now()).slice(0, 10);
}

const toInt = (v: string): number => (v.trim() === '' ? Number.NaN : Number(v.trim()));

interface Outcome {
  file: string;
  /** Errores del compilador en esta nota: el evento no se ha cargado. */
  blocking: VaultIssue[];
  /** Errores en otras notas del vault (primeros 5) cuando el catálogo no se ha recargado. */
  notApplied: VaultIssue[] | null;
  totalErrors: number;
  warnings: VaultIssue[];
  /** Evento guardado y cargado (solo si no hay nada bloqueante). */
  savedId: string | null;
}

function IssueList({ issues }: { issues: VaultIssue[] }) {
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
      {issues.map((i, n) => (
        <li key={`${i.file}-${n}`} className="small">
          <span className="mono">{i.file}</span>: {i.message}
        </li>
      ))}
    </ul>
  );
}

function FieldError({ msg }: { msg: string | undefined }) {
  return msg ? (
    <span className="hint" role="alert" style={{ color: 'var(--critical-ink)' }}>
      {msg}
    </span>
  ) : null;
}

const warnHint: CSSProperties = { color: 'var(--warning-ink)' };

const IMPORT_STATUS: Record<NonNullable<ImportedEvent['status']>, string> = {
  CANCELLED: 'La página dice que está CANCELADO.',
  POSTPONED: 'La página dice que está APLAZADO.',
  RESCHEDULED: 'La página dice que ha CAMBIADO DE FECHA: revisa la fecha.',
  SOLD_OUT: 'La página dice que está AGOTADO.',
};

/** Qué se ha leído de la página oficial, qué falta, y elegir fecha (si hay varias) y fase de venta. */
function ImportSummary({
  info,
  onChoose,
  onDismiss,
  newVenue,
  ai,
}: {
  info: { page: PageImport; index: number; sale: string | null };
  /** sale = undefined: la fase por defecto (la venta general próxima). */
  onChoose: (index: number, sale: string | null | undefined) => void;
  onDismiss: () => void;
  newVenue: { name: string; city: string | null } | null;
  /** Claude está completando (o ya ha completado) lo que la página no decía. */
  ai: 'working' | 'done' | null;
}) {
  const ev = info.page.events[info.index];
  if (!ev) return null;
  const got: string[] = [];
  const missing: string[] = [];
  (ev.name ? got : missing).push('nombre');
  (ev.startsAtLocal ? got : missing).push(ev.startsAtLocal && ev.timeTBA ? 'fecha (sin hora)' : 'fecha y hora');
  (ev.venueId || ev.venueName ? got : missing).push('recinto');
  (ev.url ? got : missing).push('enlace');
  (ev.sales.length > 0 ? got : missing).push('apertura de la venta');
  (ev.limit.perCustomer !== null ? got : missing).push('límite de compra');
  if (ev.price) got.push('precio');
  return (
    <Callout tone={missing.length === 0 ? 'good' : 'warning'} icon="check">
      <div className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <b>📥 Recibido de {info.page.host || 'la web oficial'}</b>
          <button type="button" className="btn sm ghost" onClick={onDismiss}>
            Ocultar
          </button>
        </div>
        <div className="small">
          Rellenado: {got.join(', ')}.{' '}
          {missing.length === 0 ? (
            'Revisa y guarda.'
          ) : ai === 'working' ? (
            <>
              No aparece en la página: {missing.join(', ')}. <b>Claude lo está buscando…</b>
            </>
          ) : ai === 'done' ? (
            <>
              No aparecía en la página: {missing.join(', ')}. <b>Lo ha buscado Claude</b>: mira su resumen abajo y revísalo.
            </>
          ) : (
            <b>
              No aparece en la página: {missing.join(', ')}
              {missing.includes('apertura de la venta') ? ' (si aún no está anunciada, ponla cuando salga: la vigilancia te lo recuerda)' : ''}. Complétalo abajo.
            </b>
          )}
        </div>
        {!ev.name && !ev.startsAtLocal ? (
          <div className="small" style={{ color: 'var(--warning-ink)' }}>
            Esta página no es la de un evento (¿la portada de {info.page.host || 'la web'}?): abre la página del evento en la web oficial y vuelve a pulsar «📥 Enviar a la
            sala».
          </div>
        ) : null}
        {ev.status ? <div className="small" style={{ color: 'var(--critical-ink)' }}>{IMPORT_STATUS[ev.status]}</div> : null}
        {newVenue ? (
          <div className="small">
            Recinto nuevo: <b>{newVenue.name}</b>
            {newVenue.city ? ` (${newVenue.city})` : ''}. No estaba en la sala: se crea al guardar.
          </div>
        ) : null}
        {info.page.events.length > 1 ? (
          <div className="field">
            <label htmlFor="evf-import-date">Esta página tiene {info.page.events.length} fechas: ¿cuál?</label>
            <select id="evf-import-date" className="input" value={info.index} onChange={(e) => onChoose(Number(e.target.value), undefined)}>
              {info.page.events.map((x, i) => (
                <option key={`${i}-${x.startsAtLocal}`} value={i}>
                  {x.startsAtLocal ? x.startsAtLocal.replace('T', ' · ') : 'sin fecha'} — {x.venueName ?? x.name ?? ''}
                  {x.city ? ` (${x.city})` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {ev.sales.length > 0 ? (
          <div className="stack" style={{ gap: 4 }}>
            <span className="small">¿Qué venta es la vuestra? Su hora será la apertura (T0):</span>
            <div className="row" style={{ gap: 6 }}>
              {ev.sales.map((x) => (
                <button key={x.name} type="button" className={`btn sm wrap ${info.sale === x.name ? 'primary' : ''}`} onClick={() => onChoose(info.index, x.name)}>
                  {info.sale === x.name ? <Icon name="check" size={12} /> : null} {x.name} · {x.startsAtLocal.replace('T', ' ')}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Callout>
  );
}

/** Enlace vacío o que no lleva a ningún evento (la portada de la web de venta): se cambia por el enlace directo de compra. */
function genericUrl(url: string, providerUrl: string | null | undefined): boolean {
  const path = (u: URL) => u.pathname.replace(/\/+$/, '');
  try {
    const a = new URL(url.trim());
    if (path(a) === '' && a.search === '') return true;
    if (!providerUrl) return false;
    const b = new URL(providerUrl);
    return a.hostname === b.hostname && path(a) === path(b) && a.search === b.search;
  } catch {
    return true;
  }
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

/** Claude trabajando (con los segundos que lleva). */
function Analyzing({ name, since }: { name: string; since: number }) {
  const now = useNow(1000);
  return (
    <Callout icon="info">
      🤖 Claude está analizando <b>{name.trim() || 'el evento'}</b>: cuántas entradas se pueden comprar (también en cada fase de venta), el recinto y cómo está estructurada
      la venta, y el enlace oficial desde el que se compra… <b>{Math.max(0, Math.round((now - since) / 1000))} s</b>
      <div className="small muted">Suele tardar 1–2 minutos. Puedes seguir mientras tanto: lo que ya venía de la web oficial o está comprobado no se toca.</div>
    </Callout>
  );
}

/** Lo que ha leído Claude: qué se ha rellenado, qué falta y qué venta es la vuestra. */
function AiSummary({
  info,
  onSale,
  venueNote,
}: {
  /** sale: posición de la fase elegida en details.sales. */
  info: { details: AiEventDetails; sale: number | null };
  onSale: (index: number) => void;
  venueNote: { tone: 'good' | 'warning' | 'info'; text: string } | null;
}) {
  const d = info.details;
  const got: string[] = [];
  const missing: string[] = [];
  (d.name ? got : missing).push('nombre');
  (d.startsAtLocal ? got : missing).push(d.startsAtLocal && d.timeTBA ? 'fecha (hora por confirmar)' : 'fecha y hora');
  (d.venue ? got : missing).push('recinto');
  (d.url ? got : missing).push('enlace oficial');
  (d.sales.length > 0 ? got : missing).push('apertura de la venta');
  (d.limit.perPerson !== null || d.sales.some((x) => x.limit !== null) ? got : missing).push('entradas por persona');
  (d.layout && d.layout.length > 0 ? got : missing).push('cómo está estructurada la venta');
  if (d.planImageUrl) got.push('plano oficial');
  const bad = d.status === 'CANCELLED' || d.status === 'POSTPONED' || d.status === 'SOLD_OUT';
  return (
    <Callout tone={missing.length === 0 ? 'good' : 'warning'} icon="check">
      <div className="stack" style={{ gap: 8 }}>
        <b>🤖 {d.name}</b>
        <div className="small">
          {fmtLocalDate(d.startsAtLocal, d.timeTBA)}
          {d.venue ? ` · ${d.venue}` : ''}
          {d.city ? ` (${d.city})` : ''}
          {d.status ? <span style={bad ? { color: 'var(--critical-ink)', fontWeight: 700 } : undefined}> · {AI_STATUS_LABEL[d.status]}</span> : null}
        </div>
        <div className="small">
          Rellenado: {got.join(', ')}.{' '}
          {missing.length > 0 ? (
            <b>
              No lo ha encontrado: {missing.join(', ')}
              {missing.includes('apertura de la venta') ? ' (si aún no está anunciada, la vigilancia te lo recordará)' : ''}. Complétalo abajo.
            </b>
          ) : (
            'Revisa y, en el paso 5, toca dónde queréis las entradas.'
          )}
        </div>
        {d.url ? (
          <div className="small">
            🔗 <b>Compra oficial{d.seller ? ` (${d.seller})` : ''}:</b>{' '}
            <a href={d.url} target="_blank" rel="noreferrer">
              {hostOf(d.url)}
            </a>{' '}
            <span className="muted">— enlace directo a la página de compra; es el botón «Abrir la web oficial» de cada tarea y de Telegram.</span>
          </div>
        ) : d.seller ? (
          <div className="small">🔗 Vende: {d.seller} (sin enlace directo: ponlo en el paso 2).</div>
        ) : null}
        {d.urlWarning ? <div className="small" style={{ color: 'var(--warning-ink)' }}>⚠️ {d.urlWarning}</div> : null}
        {venueNote ? (
          <div className="small" style={venueNote.tone === 'warning' ? { color: 'var(--warning-ink)' } : undefined}>
            {venueNote.text}
          </div>
        ) : null}
        {d.sales.length > 0 ? (
          <div className="stack" style={{ gap: 4 }}>
            <span className="small">¿Qué venta es la vuestra? Su hora será la apertura (T0){d.sales.some((x) => x.limit !== null) ? ' y su límite, el de la compra' : ''}:</span>
            <div className="row" style={{ gap: 6 }}>
              {d.sales.map((x, i) => (
                <button key={`${i}-${x.name}`} type="button" className={`btn sm wrap ${info.sale === i ? 'primary' : ''}`} onClick={() => onSale(i)}>
                  {info.sale === i ? <Icon name="check" size={12} /> : null} {x.name} · {fmtLocalDate(x.opensAtLocal)}
                  {x.limit !== null ? ` · máx. ${x.limit}/persona` : ''}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {d.layout && d.layout.length > 0 ? (
          <div className="small">
            🏟 <b>Estructura de la venta:</b> {d.layout.length} zona{d.layout.length === 1 ? '' : 's'} ({d.layout.slice(0, 4).map((z) => z.zone).join(', ')}
            {d.layout.length > 4 ? '…' : ''}). Detalle y plano en el paso 5.
          </div>
        ) : null}
        {d.price && (d.price.min !== null || d.price.max !== null) ? (
          <div className="small">
            Precios: {[d.price.min, d.price.max].filter((x) => x !== null).join(' – ')} {d.price.currency}
          </div>
        ) : null}
        {d.notes ? <div className="small ink2">ℹ️ {d.notes}</div> : null}
        {d.sources.length > 0 ? (
          <div className="small muted">
            Fuentes:{' '}
            {d.sources.slice(0, 4).map((u, i) => (
              <span key={u}>
                {i > 0 ? ' · ' : ''}
                <a href={u} target="_blank" rel="noreferrer">
                  {hostOf(u)}
                </a>
              </span>
            ))}
          </div>
        ) : null}
        <div className="small muted">{d.cached ? 'Respuesta de hace un rato (gratis).' : `Consulta: ${d.cost.usd.toFixed(2).replace('.', ',')} $ · ${d.cost.seconds} s.`}</div>
      </div>
    </Callout>
  );
}

const normLabel = (x: string) =>
  x
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Zona de nuestro plano que corresponde a una zona de la venta: la que dijo Claude o la que ya se llama así (nombre o alias). */
function ourZone(z: AiSaleZone, artifact: VenueArtifact | null): { name: string; alias: boolean } | null {
  if (!artifact) return null;
  const own = artifact.zones.find((o) => [o.name, ...o.aliases].some((a) => normLabel(a) === normLabel(z.zone)));
  if (own) return { name: own.name, alias: false };
  const mapped = z.venueZone ? artifact.zones.find((o) => normLabel(o.name) === normLabel(z.venueZone ?? '')) : undefined;
  return mapped ? { name: mapped.name, alias: true } : null;
}

/**
 * Cómo está estructurada la venta de este evento (zonas y secciones con los
 * nombres de la web, y su precio) y a qué zona de vuestro plano corresponde
 * cada una. Lo que falte en el recinto se añade con un toque.
 */
function SaleStructure({ zones, venueId, sourceUrl }: { zones: AiSaleZone[]; venueId: string | null; sourceUrl: string | null }) {
  const { artifact, loading } = useVenueArtifact(venueId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);
  const rows = useMemo(() => zones.map((z) => ({ z, ours: ourZone(z, artifact) })), [zones, artifact]);
  const missing = rows.filter((r) => !r.ours).length;
  const aliases = rows.filter((r) => r.ours?.alias).length;
  const add = async () => {
    if (!venueId) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await Api.addSaleZones(
        venueId,
        rows.map(({ z, ours }) => ({ zone: z.zone, sections: z.sections, standing: z.standing, price: z.price, venueZone: ours?.name ?? null })),
      );
      const done = [r.zones > 0 ? `${r.zones} zona${r.zones === 1 ? '' : 's'} nueva${r.zones === 1 ? '' : 's'}` : '', r.aliases > 0 ? `${r.aliases} nombre${r.aliases === 1 ? '' : 's'} de la web como alias` : '']
        .filter(Boolean)
        .join(' y ');
      setMsg(
        r.report.ok
          ? { tone: 'good', text: done ? `Añadido al recinto: ${done}. Ya puedes elegirlas abajo.` : 'El recinto ya lo tenía todo.' }
          : { tone: 'critical', text: `Se ha escrito en el vault, pero tiene errores: revísalo en Recintos · vault (${r.report.errors[0]?.message ?? ''}).` },
      );
    } catch (e) {
      setMsg({ tone: 'critical', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 8, marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <b>🏟 Cómo está estructurada la venta</b>
        {sourceUrl ? (
          <a className="small" href={sourceUrl} target="_blank" rel="noreferrer">
            según {hostOf(sourceUrl)}
          </a>
        ) : null}
      </div>
      <div className="small ink2">Las zonas tal y como las enseña la web de venta de este evento (leídas por Claude), y a qué zona de vuestro plano corresponde cada una.</div>
      <div className="table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
        <table className="t compact-sm">
          <thead>
            <tr>
              <th>Zona en la web</th>
              <th className="hide-sm">Secciones</th>
              <th>Precio</th>
              <th>En vuestro plano</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ z, ours }) => (
              <tr key={z.zone}>
                <td>
                  <b>{z.zone}</b>
                  {z.standing ? <span className="small muted"> · de pie</span> : null}
                  {z.sections.length > 0 ? <span className="small muted only-sm">{z.sections.join(', ')}</span> : null}
                </td>
                <td className="small hide-sm">{z.sections.length > 0 ? z.sections.join(', ') : '—'}</td>
                <td className="small">{z.price ?? '—'}</td>
                <td className="small">
                  {ours ? (
                    <span>→ {ours.name}</span>
                  ) : loading ? (
                    <span className="muted">…</span>
                  ) : artifact ? (
                    <Pill tone="warning">No está</Pill>
                  ) : (
                    <span className="muted">elige el recinto</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {artifact && venueId && (missing > 0 || aliases > 0) ? (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn sm wrap" disabled={busy} onClick={() => void add()}>
            {busy
              ? 'Añadiendo…'
              : missing > 0
                ? `➕ Añadir al recinto ${missing === 1 ? 'la zona que falta' : `las ${missing} zonas que faltan`}${aliases > 0 ? ' (y los nombres de la web como alias)' : ''}`
                : '➕ Guardar en el recinto los nombres que usa la web (como alias)'}
          </button>
          <span className="small muted">Así podréis elegirlas en el plano y las tareas hablarán como la web.</span>
        </div>
      ) : null}
      {msg ? <Callout tone={msg.tone}>{msg.text}</Callout> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function EventForm({
  initial,
  imported,
  top,
  onDone,
}: {
  initial?: CatalogEvent;
  imported?: PageImport | null;
  /** ⭐ Gran partido que se prepara: vigilancia de 2 semanas y 1 entrada por cuenta. */
  top?: TopMatch | null;
  onDone: (eventId: string | null) => void;
}) {
  const s = useLive();
  const now = useNow(30_000);
  const { run, busy } = useAction();
  const providers = useMemo(() => sortProviders(s.providerAuthorizations), [s.providerAuthorizations]);
  const venues = s.vault?.venues ?? [];
  // Un evento nuevo empieza por «Dónde se vende» (sin nada elegido).
  const [f, setF] = useState<FormState>(() =>
    initial
      ? fromEvent(initial)
      : top
        ? {
            ...blank(top.providerId ?? ''),
            // Lo que ya se sabe del partido: sin Claude (o si falla) el formulario no queda vacío.
            name: top.name.slice(0, 120),
            startsAt: top.startsAtLocal ?? '',
            onSaleAt: top.saleOpensLocal ?? '',
            url: top.ticketUrl ?? '',
            venueId: top.vaultVenueId ?? (top.venue ? NEW_VENUE : ''),
            newVenue: !top.vaultVenueId && top.venue ? { name: top.venue.slice(0, 100), city: top.city } : null,
            watchDaysBefore: String(TOP_WATCH_DAYS),
            perAccountQty: String(TOP_PER_ACCOUNT),
          }
        : blank(''),
  );
  /** Último estado del formulario (para lo que llega tarde, como el análisis de Claude). */
  const fRef = useRef(f);
  fRef.current = f;
  /** El gran partido, como evento para que Claude lo lea directamente. */
  const topSummary = useMemo<AiEventSummary | null>(
    () =>
      top
        ? {
            name: top.name,
            startsAtLocal: top.startsAtLocal,
            timeTBA: top.timeTBA,
            venue: top.venue,
            city: top.city,
            url: top.ticketUrl,
            saleOpensLocal: top.saleOpensLocal,
            sourceUrl: null,
            vaultVenueId: top.vaultVenueId,
          }
        : null,
    [top],
  );
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** Nota creada desde este formulario (las siguientes veces se actualiza en vez de crear). */
  const [created, setCreated] = useState<{ file: string; id: string | null } | null>(null);
  const tz = useMemo(browserTimeZone, []);
  /** Último evento elegido de la fuente oficial (para enseñar de dónde sale cada dato). */
  const [picked, setPicked] = useState<{ event: FeedEvent; sale: FeedSale | null } | null>(null);
  /** Página oficial enviada con «📥 Enviar a la sala» (y qué evento y fase de venta se usan). */
  const [fromPage, setFromPage] = useState<{ page: PageImport; index: number; sale: string | null } | null>(null);
  /** Evento leído por Claude (y qué fase de venta es la apertura: su posición en details.sales). */
  const [aiPicked, setAiPicked] = useState<{ details: AiEventDetails; sale: number | null } | null>(null);
  /** La lista de Claude está buscando o leyendo un evento (no se ofrece otra consulta a la vez). */
  const [pickerBusy, setPickerBusy] = useState(false);
  /** Plano oficial recién encontrado por Claude: se sitúan sus zonas en cuanto el recinto esté listo. */
  const [planFresh, setPlanFresh] = useState(false);
  /** Qué pasa con el recinto del evento elegido (se crea al momento si no estaba). */
  const [venueNote, setVenueNote] = useState<{ tone: 'good' | 'warning' | 'info'; text: string } | null>(null);
  // Si el evento ya viene elegido (de su página oficial), Claude no busca la lista: lo analiza directamente.
  const [showAi, setShowAi] = useState(!initial && !imported);
  const [otherWays, setOtherWays] = useState(false);
  const aiReady = Boolean(s.system?.ai.configured);

  /** El recinto del evento de Claude: el de la sala o uno nuevo, creado ya (para ver su plano y elegir dónde). */
  const venueRun = useRef(0);
  const ensureVenue = async (d: AiEventDetails) => {
    const run = ++venueRun.current;
    const known = d.vaultVenueId && venues.some((v) => v.venueId === d.vaultVenueId) ? d.vaultVenueId : null;
    const name = (d.venue ?? '').trim().slice(0, 100);
    const same = known ?? (name ? (venues.find((v) => v.name.trim().toLowerCase() === name.toLowerCase())?.venueId ?? null) : null);
    if (same) {
      setF((x) => ({ ...x, venueId: same, newVenue: null }));
      setVenueNote({ tone: 'good', text: 'El recinto ya está en la sala: elegido automáticamente.' });
      return;
    }
    if (name.length < 3) {
      setVenueNote({ tone: 'warning', text: 'Claude no ha encontrado el recinto: elígelo en la lista.' });
      return;
    }
    const layout = aiLayoutText(d.layout);
    setVenueNote({ tone: 'info', text: `Creando el recinto «${name}»${layout ? ' con las zonas de la web oficial' : ''}…` });
    try {
      const r = await Api.createVenue({
        name,
        city: d.city ?? undefined,
        source: (layout
          ? `Zonas leídas por Claude de ${d.sources[0] ?? d.url ?? 'la web de venta'}: revísalas con el plano oficial`
          : `Creado al elegir el evento${d.url ? ` (${d.url})` : ''}. Estructura orientativa: revísala con el plano oficial`
        ).slice(0, 300),
        layout: layout || guessVenueLayout(name),
      });
      if (run !== venueRun.current) return;
      if (r.venueId) {
        const id = r.venueId;
        setF((x) => ({ ...x, venueId: id, newVenue: null }));
        setVenueNote({ tone: 'good', text: `Recinto nuevo creado: ${name} (${layout ? 'con las zonas de la web oficial' : 'estructura orientativa: revísala en Recintos'}).` });
      } else {
        setF((x) => ({ ...x, venueId: NEW_VENUE, newVenue: { name, city: d.city } }));
        setVenueNote({ tone: 'warning', text: `El recinto «${name}» tiene errores en el vault: revísalo en Recintos o elige otro.` });
      }
    } catch (e) {
      if (run !== venueRun.current) return;
      setF((x) => ({ ...x, venueId: NEW_VENUE, newVenue: { name, city: d.city } }));
      setVenueNote({ tone: 'warning', text: `No se pudo crear el recinto «${name}» (${e instanceof Error ? e.message : String(e)}): elige uno de la lista.` });
    }
  };

  /** Rellena el formulario con lo que ha leído Claude. */
  /**
   * Rellena el formulario con lo que ha analizado Claude. `replace`: el evento
   * se ha elegido de la lista de Claude (manda Claude). `complete`: el evento ya
   * venía de otro sitio (página oficial, lista oficial, o ya guardado) y Claude
   * completa lo que falta sin pisar lo que ya es oficial o está comprobado.
   */
  const applyAi = (d: AiEventDetails, mode: 'replace' | 'complete' = 'replace') => {
    const nowLocal = madridLocal(Date.now());
    // Completando, manda la apertura que ya estaba puesta (su fase y su límite); si no hay, la venta general próxima.
    const openedAt = mode === 'complete' ? fRef.current.onSaleAt : '';
    const chosen = openedAt ? d.sales.find((x) => x.opensAtLocal === openedAt) : aiDefaultSale(d.sales, nowLocal);
    const saleIndex = chosen ? d.sales.indexOf(chosen) : null;
    const draft = aiEventDraft(d, { today: nowLocal.slice(0, 10), nowLocal, saleIndex });
    setAiPicked({ details: d, sale: saleIndex });
    setErrors({});
    if (mode === 'complete') {
      // Se mira ahora: cuando React aplique esto, el formulario ya tendrá el plano nuevo.
      const hadPlan = Boolean(fRef.current.plan);
      setPlanFresh((was) => was || (Boolean(d.planImageUrl) && !hadPlan));
      setF((x) => {
        const n = draft.limit?.perAccount ?? null;
        const limits: Partial<FormState> =
          !x.limitsVerified && draft.limit && n !== null
            ? {
                limitPerAccount: String(n),
                limitPerGroup: String(n),
                limitPerOperation: String(Math.max(n, toInt(x.limitPerOperation) || 0)),
                limitSemantics: draft.limit.semantics,
                limitsVerified: draft.limit.verified,
                limitsSource: draft.limit.source,
                limitsNotes: draft.limit.notes,
              }
            : {};
        return {
          ...x,
          name: x.name.trim().length >= 3 ? x.name : draft.name,
          url: draft.url && genericUrl(x.url, providers.find((p) => p.providerId === x.providerId)?.url) ? draft.url : x.url,
          startsAt: x.startsAt || (draft.startsAt ?? ''),
          onSaleAt: x.onSaleAt || (draft.onSaleAt ?? ''),
          ...limits,
          notes: x.notes.trim() ? `${x.notes.trim()}\n\n${draft.notes}` : draft.notes,
          plan: x.plan ?? (d.planImageUrl ? { image: d.planImageUrl, points: [] } : null),
          saleZones: d.layout ?? x.saleZones,
        };
      });
      if (!fRef.current.venueId || fRef.current.venueId === NEW_VENUE) void ensureVenue(d);
      return;
    }
    setPicked(null);
    setFromPage(null);
    setPlanFresh(Boolean(d.planImageUrl));
    setF((x) => {
      const n = draft.limit?.perAccount ?? null;
      const limits: Partial<FormState> =
        draft.limit && n !== null
          ? {
              limitPerAccount: String(n),
              limitPerGroup: String(n),
              limitPerOperation: String(Math.max(n, toInt(x.limitPerOperation) || 0)),
              limitSemantics: draft.limit.semantics,
              limitsVerified: draft.limit.verified,
              limitsSource: draft.limit.source,
              limitsNotes: draft.limit.notes,
            }
          : { limitsVerified: false, limitsSource: draft.limitsSource || x.limitsSource };
      return {
        ...x,
        name: draft.name.length >= 3 ? draft.name : x.name,
        url: draft.url ?? x.url,
        providerEventRef: '',
        startsAt: draft.startsAt ?? x.startsAt,
        onSaleAt: draft.onSaleAt ?? '',
        currency: draft.currency,
        ...limits,
        notes: draft.notes,
        officialFeed: null,
        officialId: '',
        officialSale: null,
        watchDaysBefore: x.watchDaysBefore === '0' ? '2' : x.watchDaysBefore,
        seats: [],
        plan: d.planImageUrl ? { image: d.planImageUrl, points: [] } : null,
        saleZones: d.layout ?? [],
      };
    });
    void ensureVenue(d);
  };

  /** Claude analiza el evento que ya hay en el formulario y completa lo que falte. */
  const [analyzing, setAnalyzing] = useState<{ since: number } | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const analyzeRun = useRef(0);
  const analyzeWithClaude = async (hint?: {
    name?: string | null;
    startsAtLocal?: string | null;
    venue?: string | null;
    city?: string | null;
    url?: string | null;
    providerId?: string | null;
    /** Volver a leerlo aunque haya una respuesta de hace un rato. */
    fresh?: boolean;
  }) => {
    const cur = fRef.current;
    const providerId = hint?.providerId ?? cur.providerId;
    const name = (hint?.name ?? cur.name).trim();
    if (!aiReady || !providerId || name.length < 3) return;
    const run = ++analyzeRun.current;
    setAnalyzing({ since: Date.now() });
    setAnalyzeError(null);
    try {
      const venueName = hint?.venue ?? (cur.venueId && cur.venueId !== NEW_VENUE ? (venues.find((v) => v.venueId === cur.venueId)?.name ?? null) : (cur.newVenue?.name ?? null));
      const d = await Api.aiEvent({
        providerId,
        name,
        startsAtLocal: hint?.startsAtLocal ?? (cur.startsAt || null),
        venue: venueName,
        city: hint?.city ?? null,
        url: hint?.url ?? (cur.url.trim() || null),
        ...(hint?.fresh ? { fresh: true } : {}),
      });
      if (run === analyzeRun.current) applyAi(d, 'complete');
    } catch (e) {
      if (run === analyzeRun.current) setAnalyzeError(e instanceof Error ? e.message : String(e));
    } finally {
      if (run === analyzeRun.current) setAnalyzing(null);
    }
  };

  /** Otra fase de venta como apertura (socios, preventa, general…), con su límite si la web lo da. Por posición: dos fases pueden llamarse igual. */
  const chooseAiSale = (index: number) => {
    const sale = aiPicked?.details.sales[index];
    if (!aiPicked || !sale) return;
    const nowLocal = madridLocal(Date.now());
    const opts = { today: nowLocal.slice(0, 10), nowLocal };
    const beforeDraft = aiEventDraft(aiPicked.details, { ...opts, saleIndex: aiPicked.sale });
    const afterDraft = aiEventDraft(aiPicked.details, { ...opts, saleIndex: index });
    const before = beforeDraft.limit;
    const after = afterDraft.limit;
    setAiPicked({ ...aiPicked, sale: index });
    setF((x) => {
      // Solo si el límite que hay es el que puso Claude (no uno oficial ni cambiado a mano).
      const untouched = before !== null && x.limitPerAccount === String(before.perAccount) && x.limitsSource === before.source;
      const limits: Partial<FormState> =
        untouched && after
          ? {
              limitPerAccount: String(after.perAccount),
              limitPerGroup: String(after.perAccount),
              limitPerOperation: String(Math.max(after.perAccount, toInt(x.limitPerOperation) || 0)),
              // Verificado solo si la fase no da más que la frase oficial: al cambiar de fase se recalcula.
              limitsVerified: after.verified,
              limitsSource: after.source,
              limitsNotes: x.limitsNotes === before.notes ? after.notes : x.limitsNotes,
            }
          : {};
      // La nota dice qué apertura se eligió: se cambia si sigue siendo la que escribió Claude.
      const notes = beforeDraft.notes && x.notes.includes(beforeDraft.notes) ? x.notes.replace(beforeDraft.notes, () => afterDraft.notes) : x.notes;
      return { ...x, onSaleAt: sale.opensAtLocal, ...limits, notes };
    });
  };

  /** Rellena el formulario con lo leído de la página oficial. */
  const applyImported = (page: PageImport, index: number, saleName: string | null | undefined) => {
    const ev = page.events[index];
    if (!ev) return;
    const nowLocal = madridLocal(Date.now());
    const sale =
      saleName === undefined
        ? (ev.sales.find((x) => /general/i.test(x.name) && x.startsAtLocal >= nowLocal) ?? ev.sales.find((x) => x.startsAtLocal >= nowLocal) ?? ev.sales.at(-1) ?? null)
        : (ev.sales.find((x) => x.name === saleName) ?? null);
    setFromPage({ page, index, sale: sale?.name ?? null });
    setPicked(null);
    setErrors({});
    setF((x) => {
      const providerId = page.providerId ?? (providers.some((p) => p.providerId === 'manual') ? 'manual' : x.providerId);
      const n = ev.limit.perCustomer;
      const limits: Partial<FormState> =
        n !== null
          ? {
              limitPerAccount: String(n),
              limitPerGroup: String(n),
              limitPerOperation: String(Math.max(n, toInt(x.limitPerOperation) || 0)),
              limitSemantics: ev.limit.semantics ?? 'PER_HOLDER',
              limitsVerified: true,
              limitsSource: `Página oficial (${page.host}), ${madridToday()}: «${ev.limit.text ?? `${n} por cliente`}»${ev.url ? ` · ${ev.url}` : ''}`.slice(0, 500),
            }
          : { limitsVerified: false, limitsSource: ev.url ? `Página oficial: ${ev.url}`.slice(0, 500) : x.limitsSource };
      const venue: Partial<FormState> = ev.venueId
        ? { venueId: ev.venueId, newVenue: null }
        : ev.venueName
          ? { venueId: NEW_VENUE, newVenue: { name: ev.venueName.slice(0, 100), city: ev.city } }
          : {};
      return {
        ...x,
        providerId,
        name: ev.name ? ev.name.slice(0, 120) : x.name,
        url: ev.url ?? x.url,
        startsAt: ev.startsAtLocal ?? x.startsAt,
        onSaleAt: sale?.startsAtLocal ?? '',
        currency: ev.price?.currency && /^[A-Z]{3}$/.test(ev.price.currency) ? ev.price.currency : x.currency,
        ...limits,
        ...venue,
        watchDaysBefore: x.watchDaysBefore === '0' ? '2' : x.watchDaysBefore,
      };
    });
  };

  /**
   * Con la clave de Ticketmaster (o el token de los partidos), el evento traído de
   * la página se busca también en la fuente oficial: si está, queda vinculado y la
   * vigilancia avisará de los cambios (no solo recordatorios).
   */
  const linkRun = useRef(0);
  const tryLinkOfficial = async (ev: ImportedEvent, providerId: string | null) => {
    const run = ++linkRun.current;
    const start = ev.startsAtLocal ? madridEpoch(ev.startsAtLocal) : null;
    if (!ev.name || start === null) return;
    const feeds = s.system?.feeds;
    const days = Math.min(400, Math.max(1, Math.ceil((start - Date.now()) / 86_400_000) + 1));
    let found: FeedEvent | undefined;
    try {
      if (providerId === 'ticketmaster' && feeds?.ticketmaster.configured) {
        const r = await Api.feedEvents({ feed: 'ticketmaster', days, q: ev.name.slice(0, 60) });
        found = r.events.find((e) => e.startsAt !== null && Math.abs(Date.parse(e.startsAt) - start) <= 10 * 60_000);
      } else if (providerId === 'real-madrid' && feeds?.football.configured) {
        const r = await Api.feedEvents({ feed: 'football', days, club: 'Real Madrid' });
        found = r.events.find((e) => e.startsAtLocal !== null && e.startsAtLocal.slice(0, 10) === ev.startsAtLocal?.slice(0, 10));
      }
    } catch {
      return; // sin vínculo: la vigilancia manda recordatorios igualmente
    }
    if (!found || run !== linkRun.current) return;
    const match = found;
    setF((x) => ({
      ...x,
      officialFeed: match.feed,
      officialId: match.id,
      officialSale: match.sales.find((sale) => sale.startsAtLocal !== null && sale.startsAtLocal === x.onSaleAt)?.name ?? null,
    }));
  };

  // Lo que llega de «📥 Enviar a la sala» se aplica al abrir el formulario.
  const appliedImport = useRef<PageImport | null>(null);
  useEffect(() => {
    if (!imported || appliedImport.current === imported) return;
    appliedImport.current = imported;
    applyImported(imported, 0, undefined);
    const first = imported.events[0];
    if (first) void tryLinkOfficial(first, imported.providerId);
    // Claude analiza el evento traído y completa lo que la página no decía (límite, estructura, plano…).
    if (first?.name) {
      void analyzeWithClaude({
        providerId: imported.providerId ?? (providers.some((p) => p.providerId === 'manual') ? 'manual' : null),
        name: first.name,
        startsAtLocal: first.startsAtLocal,
        venue: first.venueName,
        city: first.city,
        url: first.url,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imported]);

  const createdEvent = created
    ? (Object.values(s.events).find((e) => e.sourceFile === created.file) ?? (created.id ? s.events[created.id] : undefined))
    : undefined;
  const target = initial ?? createdEvent;
  const creating = !target;
  /** Nota ya creada pero todavía fuera del catálogo: no se puede volver a crear ni actualizar desde aquí. */
  const lockedCreate = !initial && created !== null && !createdEvent;

  const provider = providers.find((p) => p.providerId === f.providerId);
  const perAccountMode = f.limitSemantics === 'PER_ACCOUNT';

  /** Cuántas entradas se pueden comprar en total con las cuentas de esta web y este límite. */
  const capacity = useMemo(() => {
    const n = toInt(f.limitPerAccount);
    if (!provider || provider.mode === 'SIMULATED' || !Number.isInteger(n) || n < 1) return null;
    const accounts = Object.values(s.accounts).filter((a) => a.providerId === f.providerId);
    if (accounts.length === 0) return `Aún no hay cuentas de ${provider.name}: añádelas en Cuentas (una por persona que va) para saber cuántas entradas podéis comprar.`;
    const group: Record<LimitSemantics, ((a: (typeof accounts)[number]) => string) | null> = {
      PER_ACCOUNT: (a) => a.id,
      PER_HOLDER: (a) => a.holderRef,
      PER_HOUSEHOLD: (a) => a.householdRef ?? a.holderRef,
      PER_PAYMENT_METHOD: (a) => a.paymentRef ?? a.id,
      UNKNOWN: null,
    };
    const by = group[f.limitSemantics];
    if (!by) return null;
    const groups = new Set(accounts.map(by)).size;
    const perGroup = perAccountMode ? n : toInt(f.limitPerGroup) || n;
    const cap = toInt(f.limitPerOperation);
    const total = Math.min(groups * perGroup, Number.isInteger(cap) && cap > 0 ? cap : Number.POSITIVE_INFINITY);
    const units = { PER_ACCOUNT: ['cuenta', 'cuentas'], PER_HOLDER: ['titular', 'titulares'], PER_HOUSEHOLD: ['hogar', 'hogares'], PER_PAYMENT_METHOD: ['tarjeta', 'tarjetas'], UNKNOWN: ['', ''] }[f.limitSemantics];
    const unit = units[groups === 1 ? 0 : 1];
    return `Con tus ${accounts.length} cuenta${accounts.length === 1 ? '' : 's'} de ${provider.name} (${groups} ${unit}): hasta ${total} entrada${total === 1 ? '' : 's'} en total.`;
  }, [provider, s.accounts, f.providerId, f.limitPerAccount, f.limitPerGroup, f.limitPerOperation, f.limitSemantics, perAccountMode]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => {
      const key = k as Field;
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };

  const bad = (k: Field): CSSProperties | undefined => (errors[k] ? { borderColor: 'var(--critical)' } : undefined);

  /** Rellena el formulario con los datos oficiales del evento elegido. */
  const pickOfficial = (e: FeedEvent, sale: FeedSale | null) => {
    setPicked({ event: e, sale });
    setFromPage(null);
    setErrors({});
    setF((x) => {
      const n = e.limit.perCustomer;
      const src = e.feed === 'ticketmaster' ? 'Ticketmaster (API oficial)' : 'football-data.org';
      const limits: Partial<FormState> =
        n !== null
          ? {
              limitPerAccount: String(n),
              limitPerGroup: String(n),
              limitPerOperation: String(Math.max(n, toInt(x.limitPerOperation) || 0)),
              limitSemantics: e.limit.semantics ?? 'PER_HOLDER',
              limitsVerified: true,
              limitsSource: `${src}, ${madridToday()}: «${e.limit.text ?? `${n} por cliente`}»${e.url ? ` · ${e.url}` : ''}`.slice(0, 500),
            }
          : { limitsVerified: false, limitsSource: e.url ? `Página oficial: ${e.url}`.slice(0, 500) : x.limitsSource };
      // Los partidos los vende el club en su web: Real Madrid → su proveedor; el resto → «Otra web oficial».
      let providerId = x.providerId;
      if (e.feed === 'football' && (providerId === '' || providerId === 'ticketmaster' || providers.find((p) => p.providerId === providerId)?.mode === 'SIMULATED')) {
        const isRM = (s.vault?.venues.find((v) => v.venueId === (e.vaultVenueId ?? x.venueId))?.clubs ?? []).some((c) => /real madrid/i.test(c)) || /real madrid/i.test(e.home ?? '');
        const wanted = isRM ? 'real-madrid' : 'manual';
        if (providers.some((p) => p.providerId === wanted)) providerId = wanted;
      }
      const providerUrl = providers.find((p) => p.providerId === providerId)?.url ?? '';
      // Recinto: el de la sala que le corresponde o, si no está, uno nuevo que se crea al guardar.
      const venue: Partial<FormState> = e.vaultVenueId
        ? { venueId: e.vaultVenueId, newVenue: null }
        : e.venue?.name
          ? { venueId: NEW_VENUE, newVenue: { name: e.venue.name.slice(0, 100), city: e.venue.city } }
          : {};
      return {
        ...x,
        ...venue,
        providerId,
        name: e.name.slice(0, 120),
        url: e.url ?? (x.url || providerUrl),
        providerEventRef: e.feed === 'football' ? `partido-${e.id}` : e.id,
        startsAt: e.startsAtLocal ?? x.startsAt,
        onSaleAt: sale?.startsAtLocal ?? (e.feed === 'football' ? x.onSaleAt : ''),
        currency: e.price?.currency && /^[A-Z]{3}$/.test(e.price.currency) ? e.price.currency : x.currency,
        ...limits,
        officialFeed: e.feed,
        officialId: e.id,
        officialSale: sale?.name ?? null,
        watchDaysBefore: x.watchDaysBefore === '0' ? '2' : x.watchDaysBefore,
      };
    });
    // Claude analiza el evento elegido y completa lo que la lista oficial no trae (límite, estructura, plano…).
    const aiProvider =
      e.feed === 'ticketmaster'
        ? 'ticketmaster'
        : /real madrid/i.test(e.home ?? '') && providers.some((p) => p.providerId === 'real-madrid')
          ? 'real-madrid'
          : fRef.current.providerId || (providers.some((p) => p.providerId === 'manual') ? 'manual' : null);
    void analyzeWithClaude({ providerId: aiProvider, name: e.name, startsAtLocal: e.startsAtLocal, venue: e.venue?.name ?? null, city: e.venue?.city ?? null, url: e.url });
  };

  const unlinkOfficial = () => {
    setPicked(null);
    setF((x) => ({ ...x, officialFeed: null, officialId: '', officialSale: null }));
  };

  const validate = (): { body: EventNoteInput | null; errs: Errors } => {
    const url = f.url.trim();
    const raw: EventNoteInput = {
      name: f.name,
      venueId: f.venueId,
      providerId: f.providerId,
      url: url === '' ? null : url,
      providerEventRef: f.providerEventRef.trim() === '' ? undefined : f.providerEventRef.trim(),
      startsAt: f.startsAt,
      onSaleAt: f.onSaleAt === '' ? null : f.onSaleAt,
      currency: f.currency,
      limitPerAccount: toInt(f.limitPerAccount),
      limitPerGroup: perAccountMode ? toInt(f.limitPerAccount) : toInt(f.limitPerGroup),
      limitPerOperation: toInt(f.limitPerOperation),
      limitSemantics: f.limitSemantics,
      limitsVerified: f.limitsVerified,
      limitsSource: f.limitsSource,
      limitsNotes: f.limitsNotes.trim() === '' ? undefined : f.limitsNotes,
      ...(creating && f.notes.trim() !== '' ? { notes: f.notes } : {}),
      officialFeed: f.officialFeed,
      officialId: f.officialFeed ? f.officialId : null,
      officialSale: f.officialFeed ? f.officialSale : null,
      watchDaysBefore: Number(f.watchDaysBefore) || 0,
      preferredTargets: f.seats,
      perAccountQty: f.perAccountQty === '' ? null : Number(f.perAccountQty),
      saleZones: aiSaleZonesText(f.saleZones),
      planImage: f.plan?.image ?? null,
      planPoints: f.plan?.points ?? [],
    };
    const errs: Errors = {};
    if (url !== '' && !/^https?:\/\//i.test(url)) errs.url = 'Pega el enlace completo, empezando por https://';
    if (f.startsAt === '') errs.startsAt = 'Pon la fecha y hora del evento';
    const r = EventNoteInputSchema.safeParse(raw);
    if (!r.success) {
      for (const issue of r.error.issues) {
        const field = FIELDS.find((x) => x === String(issue.path[0]));
        if (!field || errs[field]) continue;
        errs[field] = issueMessage(field, issue.code, issue.message);
      }
    }
    return { body: r.success && Object.keys(errs).length === 0 ? r.data : null, errs };
  };

  /** Crea el recinto nuevo (o usa el que ya exista con ese nombre) y devuelve su id. */
  const createPendingVenue = async (): Promise<string | null> => {
    const nv = f.newVenue;
    if (!nv) return null;
    const existing = venues.find((v) => v.name.trim().toLowerCase() === nv.name.trim().toLowerCase());
    if (existing) return existing.venueId;
    try {
      const r = await Api.createVenue({
        name: nv.name,
        city: nv.city ?? undefined,
        source: `Creado al elegir el evento${f.url ? ` (${f.url})` : ''}. Estructura orientativa: revísala con el plano oficial`.slice(0, 300),
        layout: guessVenueLayout(nv.name),
      });
      return r.venueId;
    } catch (e) {
      setServerError(`No se pudo crear el recinto «${nv.name}»: ${e instanceof Error ? e.message : String(e)}. Elige otro recinto en la lista.`);
      return null;
    }
  };

  const submit = async () => {
    setServerError(null);
    setOutcome(null);
    const { body, errs } = validate();
    setErrors(errs);
    if (!body || lockedCreate) return;
    if (body.venueId === NEW_VENUE) {
      const venueId = await createPendingVenue();
      if (!venueId) {
        setErrors((e) => ({ ...e, venueId: 'No se pudo crear el recinto: elige uno de la lista' }));
        return;
      }
      body.venueId = venueId;
      setF((x) => ({ ...x, venueId, newVenue: null }));
    }
    const saveTarget = target;
    const hadEvents = Object.keys(s.events).length > 0;
    const notReloaded = (r: { event: CatalogEvent | null; report: { ok: boolean } }) => r.event === null || (!r.report.ok && hadEvents);
    const r = await run(
      async () => {
        try {
          return await (saveTarget ? Api.updateEventNote(saveTarget.id, body) : Api.createEventNote(body));
        } catch (e) {
          if (e instanceof ApiError) {
            setServerError(e.message);
            if (e.status === 400) setErrors(parseServerErrors(e.message));
          }
          throw e;
        }
      },
      (res) => (res.issues.every((i) => i.severity !== 'ERROR') && !notReloaded(res) ? `Evento guardado en ${res.file}` : null),
    );
    if (!r) return;
    if (!saveTarget) setCreated({ file: r.file, id: r.event?.id ?? null });
    const blocking = r.issues.filter((i) => i.severity === 'ERROR');
    const warnings = r.issues.filter((i) => i.severity === 'WARNING');
    const stale = blocking.length === 0 && notReloaded(r);
    if (blocking.length === 0 && !stale && r.event && warnings.length === 0) {
      onDone(r.event.id);
      return;
    }
    setOutcome({
      file: r.file,
      blocking,
      notApplied: stale ? r.report.errors.slice(0, 5) : null,
      totalErrors: r.report.errors.length,
      warnings,
      savedId: blocking.length === 0 && !stale && r.event ? r.event.id : null,
    });
  };

  const startEpoch = madridEpoch(f.startsAt);
  const saleEpoch = madridEpoch(f.onSaleAt);
  const anchorEpoch = saleEpoch ?? startEpoch;
  // A la misma hora de reloj aunque entre medias cambie la hora (como la vigilancia del servidor).
  const watchFrom = anchorEpoch === null ? null : watchStartMs(anchorEpoch, Number(f.watchDaysBefore) || 0, MADRID_TZ);
  const errorCount = Object.keys(errors).length;
  /** La fase de venta elegida tiene un límite menor que el puesto (p. ej. 1 en la de socios), por cuenta o, sumando cuentas, por grupo. */
  const aiSale = aiPicked && aiPicked.sale !== null ? (aiPicked.details.sales[aiPicked.sale] ?? null) : null;
  const excess = aiSale
    ? limitAbovePhase(
        { perAccount: toInt(f.limitPerAccount), perGroup: perAccountMode ? toInt(f.limitPerAccount) : toInt(f.limitPerGroup), semantics: f.limitSemantics },
        aiSale.limit,
      )
    : null;
  const overPhase = aiSale && aiSale.limit !== null && excess ? { name: aiSale.name, limit: aiSale.limit, ...excess } : null;
  const title = initial ? `Editar ${initial.name}` : createdEvent ? `Editar ${createdEvent.name}` : 'Nuevo evento';

  return (
    <Card
      flush
      title={title}
      actions={
        <button type="button" className="btn sm ghost" onClick={() => onDone(null)} title="Cerrar sin guardar" aria-label="Cerrar">
          <Icon name="x" size={14} />
        </button>
      }
    >
      {!s.vault ? (
        <div className="form-section">
          <Callout tone="warning">No hay vault cargado todavía. Revisa «Recintos · vault» antes de crear eventos.</Callout>
        </div>
      ) : null}

      <div className="form-section">
        <h3 className="sign">1 · Dónde se vende</h3>
        <div className="stack">
          {top ? (
            <Callout tone="good" icon="check">
              <b>⭐ Gran partido: {top.name}</b> ({top.competition}). Se vigila desde <b>{TOP_WATCH_DAYS / 7} semanas antes de la venta</b> y va{' '}
              <b>{TOP_PER_ACCOUNT} entrada por cuenta</b>: al abrir la venta, todas las cuentas van a la vez, cada una a por la suya.
            </Callout>
          ) : null}
          <div className="field" style={{ maxWidth: 520 }}>
            <label htmlFor="evf-provider">Web de venta</label>
            <select
              id="evf-provider"
              className="input"
              value={f.providerId}
              onChange={(e) => {
                set('providerId', e.target.value);
                if (f.officialFeed === 'ticketmaster' && e.target.value !== 'ticketmaster') unlinkOfficial();
              }}
              aria-invalid={Boolean(errors.providerId)}
              style={bad('providerId')}
            >
              {f.providerId === '' ? <option value="">Elige dónde se vende…</option> : null}
              {providers.map((p) => (
                <option key={p.providerId} value={p.providerId}>
                  {p.name} · {MODE_LABEL[p.mode]}
                </option>
              ))}
              {f.providerId && !provider ? <option value={f.providerId}>{f.providerId} (no está en el vault)</option> : null}
            </select>
            <FieldError msg={errors.providerId} />
            {f.providerId === '' ? <span className="hint">Empieza por aquí: después eliges el evento y se rellena todo lo demás (recinto incluido).</span> : null}
          </div>
          {fromPage ? (
            <ImportSummary
              info={fromPage}
              onChoose={(index, sale) => {
                applyImported(fromPage.page, index, sale);
                const ev = fromPage.page.events[index];
                if (ev && index !== fromPage.index) void tryLinkOfficial(ev, fromPage.page.providerId);
              }}
              onDismiss={() => setFromPage(null)}
              newVenue={f.venueId === NEW_VENUE ? f.newVenue : null}
              ai={analyzing ? 'working' : aiPicked ? 'done' : null}
            />
          ) : null}
          {provider && provider.mode !== 'SIMULATED' ? (
            aiReady ? (
              showAi ? (
                <ClaudeEventPicker
                  key={`ai-${f.providerId}`}
                  provider={provider}
                  picked={aiPicked?.details.name ?? null}
                  onPicked={applyAi}
                  onBusy={setPickerBusy}
                  autoPick={top && f.providerId === top.providerId ? topSummary : null}
                />
              ) : (
                <div>
                  <button type="button" className="btn sm" onClick={() => setShowAi(true)}>
                    🤖 Buscar el evento con Claude
                  </button>
                </div>
              )
            ) : (
              <Callout tone="warning">
                🤖 <b>Conecta Claude</b> en <Link to="/ajustes#claude">Ajustes → Claude (IA)</Link>: al elegir la web de venta buscará sus eventos y lo rellenará todo solo
                (fechas, apertura, cuántas entradas por persona, el recinto y su plano para elegir dónde).
              </Callout>
            )
          ) : null}
          {analyzing ? <Analyzing name={f.name} since={analyzing.since} /> : null}
          {aiPicked ? <AiSummary info={aiPicked} onSale={chooseAiSale} venueNote={venueNote} /> : null}
          {analyzeError ? (
            <Callout tone="critical">
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <span>Claude no ha podido analizar el evento: {analyzeError}</span>
                <button type="button" className="btn sm" onClick={() => void analyzeWithClaude()}>
                  Reintentar
                </button>
              </div>
            </Callout>
          ) : null}
          {aiReady && provider && provider.mode !== 'SIMULATED' && !analyzing && !(showAi && pickerBusy) && f.name.trim().length >= 3 ? (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn sm" onClick={() => void analyzeWithClaude(aiPicked ? { fresh: true } : undefined)}>
                🤖 {aiPicked ? 'Volver a analizar con Claude' : 'Analizar con Claude'}
              </button>
              <span className="small muted">
                {aiPicked
                  ? 'Lo vuelve a leer todo en la web oficial (otra consulta).'
                  : 'Lee la web oficial y rellena lo que falte: cuántas entradas por persona, el recinto y cómo está estructurada la venta, y el enlace oficial de compra.'}
              </span>
            </div>
          ) : null}
          {!aiReady || otherWays || f.officialFeed !== null || !provider || provider.mode === 'SIMULATED' ? (
            <EventSourcePanel
              key={`src-${f.providerId}`}
              provider={provider ?? null}
              linked={f.officialFeed ? { feed: f.officialFeed, id: f.officialId, name: picked?.event.name ?? (initial?.officialId === f.officialId ? initial.name : null), sale: f.officialSale } : null}
              onPick={pickOfficial}
              onUnlink={unlinkOfficial}
            />
          ) : (
            <div>
              <button type="button" className="btn sm ghost" onClick={() => setOtherWays(true)}>
                Otras formas de traer el evento (sin Claude)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="form-section">
        <h3 className="sign">2 · Evento</h3>
        <div className="stack">
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="evf-venue">Recinto</label>
              <select
                id="evf-venue"
                className="input"
                value={f.venueId}
                onChange={(e) => {
                  set('venueId', e.target.value);
                  // Otro recinto: las zonas elegidas eran del anterior.
                  if (e.target.value !== f.venueId) setF((x) => ({ ...x, seats: [] }));
                  // El evento oficial vinculado era de otro recinto.
                  if (f.officialFeed && e.target.value !== f.venueId) unlinkOfficial();
                }}
                aria-invalid={Boolean(errors.venueId)}
                style={bad('venueId')}
              >
                <option value="">{f.providerId ? 'Se elige solo al escoger el evento (o elígelo aquí)…' : 'Elige el recinto…'}</option>
                {f.newVenue ? (
                  <option value={NEW_VENUE}>
                    ➕ {f.newVenue.name}
                    {f.newVenue.city ? ` (${f.newVenue.city})` : ''} — recinto nuevo, se crea al guardar
                  </option>
                ) : null}
                {venues.map((v) => (
                  <option key={v.venueId} value={v.venueId}>
                    {v.name}
                  </option>
                ))}
                {f.venueId && f.venueId !== NEW_VENUE && !venues.some((v) => v.venueId === f.venueId) ? <option value={f.venueId}>{f.venueId} (no está en el vault)</option> : null}
              </select>
              <FieldError msg={errors.venueId} />
              <span className="hint">
                {f.venueId === NEW_VENUE
                  ? 'No estaba en la sala: al guardar se crea con una estructura orientativa (revísala después en Recintos).'
                  : picked || fromPage || aiPicked
                    ? 'Elegido automáticamente según el evento.'
                    : null}{' '}
                <Link to="/recintos?nuevo=1">Crear un recinto a mano</Link>
              </span>
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="evf-name">Nombre del evento</label>
              <input
                id="evf-name"
                className="input"
                value={f.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Real Madrid – Atlético · LaLiga"
                aria-invalid={Boolean(errors.name)}
                style={bad('name')}
              />
              <FieldError msg={errors.name} />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="evf-url">Enlace oficial del evento</label>
              <input
                id="evf-url"
                className="input mono"
                type="url"
                inputMode="url"
                value={f.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder={provider?.url ? `${provider.url.replace(/\/+$/, '')}/…` : 'https://…'}
                aria-invalid={Boolean(errors.url)}
                style={bad('url')}
              />
              <FieldError msg={errors.url} />
              <span className="hint">
                Aparecerá como botón «Abrir la web oficial» en cada tarea y en Telegram.
                {provider?.url ? (
                  <>
                    {' '}
                    <a href={provider.url} target="_blank" rel="noreferrer">
                      Buscar el evento en {provider.name}
                    </a>
                  </>
                ) : null}
              </span>
            </div>
            <div className="field">
              <label htmlFor="evf-ref">Referencia en la web (opcional)</label>
              <input id="evf-ref" className="input mono" value={f.providerEventRef} onChange={(e) => set('providerEventRef', e.target.value)} style={bad('providerEventRef')} />
              <FieldError msg={errors.providerEventRef} />
              <span className="hint">Si la dejas vacía se genera a partir del nombre.</span>
            </div>
            <div className="field">
              <label htmlFor="evf-currency">Moneda</label>
              <input
                id="evf-currency"
                className="input mono"
                value={f.currency}
                maxLength={3}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
                aria-invalid={Boolean(errors.currency)}
                style={bad('currency')}
              />
              <FieldError msg={errors.currency} />
            </div>
          </div>
          {provider?.mode === 'MANUAL_ASSIST' ? (
            <Callout icon="lock">
              <b>Asistencia manual:</b> el sistema no entra en {provider.name}. Cada persona compra en la web oficial con su propia cuenta; aquí se reparte el trabajo y se
              controlan límites, presupuesto y carritos.
            </Callout>
          ) : provider?.mode === 'SIMULATED' ? (
            <Callout tone="warning">
              <b>Simulado:</b> solo sirve para ensayar el flujo; no hay entradas reales.
            </Callout>
          ) : null}
        </div>
      </div>

      <div className="form-section">
        <h3 className="sign">3 · Fechas</h3>
        <div className="stack">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="evf-starts">Fecha y hora del evento</label>
              <input
                id="evf-starts"
                className="input"
                type="datetime-local"
                step={60}
                value={f.startsAt}
                onChange={(e) => set('startsAt', e.target.value.slice(0, 16))}
                aria-invalid={Boolean(errors.startsAt)}
                style={bad('startsAt')}
              />
              <FieldError msg={errors.startsAt} />
              {startEpoch !== null && startEpoch < now ? (
                <span className="hint" style={warnHint}>
                  Esa fecha ya ha pasado.
                </span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="evf-sale">Apertura de la venta (T0)</label>
              <input
                id="evf-sale"
                className="input"
                type="datetime-local"
                step={60}
                value={f.onSaleAt}
                onChange={(e) => set('onSaleAt', e.target.value.slice(0, 16))}
                aria-invalid={Boolean(errors.onSaleAt)}
                style={bad('onSaleAt')}
              />
              <FieldError msg={errors.onSaleAt} />
              {saleEpoch === null ? (
                <span className="hint">Recomendada: sin ella tendrás que poner el T0 a mano en la operación.</span>
              ) : saleEpoch < now ? (
                <span className="hint" style={warnHint}>
                  Esa hora ya ha pasado.
                </span>
              ) : (
                <span className="hint">La venta abre {fmtRel(new Date(saleEpoch).toISOString(), now)}.</span>
              )}
              {saleEpoch !== null && startEpoch !== null && saleEpoch > startEpoch ? (
                <span className="hint" style={warnHint}>
                  La venta abre después del evento: revisa las fechas.
                </span>
              ) : null}
              {f.officialSale ? <span className="hint">Es la hora oficial de «{f.officialSale}».</span> : null}
            </div>
            <div className="field">
              <label htmlFor="evf-watch">Vigilar desde</label>
              <select
                id="evf-watch"
                className="input"
                value={f.watchDaysBefore}
                disabled={Boolean(top)}
                title={top ? 'Grandes partidos: siempre 2 semanas antes' : undefined}
                onChange={(e) => set('watchDaysBefore', e.target.value)}
              >
                {WATCH_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                    {v !== '0' ? (f.onSaleAt ? ' de la venta' : ' del evento') : ''}
                  </option>
                ))}
              </select>
              <span className="hint">
                {f.watchDaysBefore === '0'
                  ? 'Sin vigilancia ni recordatorios.'
                  : f.officialFeed
                    ? `Consulta ${f.officialFeed === 'ticketmaster' ? 'Ticketmaster' : 'los partidos'} cada 10 min (cada 2 en las 3 horas finales): si cambia la fecha, la venta, el límite o se cancela, te avisa por Telegram y lo actualiza aquí. Y recordatorios el día antes y 1 hora antes.`
                    : 'Sin evento oficial vinculado: recordatorios por Telegram al empezar, el día antes y 1 hora antes.'}
              </span>
              {watchFrom !== null && f.watchDaysBefore !== '0' ? (
                <span className="hint">{watchFrom <= now ? 'Ya está dentro de la vigilancia: empieza al guardar.' : `Empieza el ${fmtMadrid(new Date(watchFrom).toISOString())}.`}</span>
              ) : null}
            </div>
          </div>
          <div className="small muted">
            Hora de Madrid. La apertura de la venta será el T0 por defecto de la operación; si vas por fases (socios, Madridistas…), pon la de tu fase.
          </div>
          {tz !== MADRID_TZ ? (
            <div className="small" style={warnHint}>
              Tu navegador no está en hora de Madrid: escribe la hora de Madrid.
            </div>
          ) : null}
        </div>
      </div>

      <div className="form-section">
        <h3 className="sign">4 · Límites de compra</h3>
        <div className="stack">
          <div className="small ink2">Cópialos de las condiciones oficiales. Sin límites verificados no se puede armar ninguna operación (fail-closed).</div>
          {aiPicked ? (
            aiPicked.details.limit.perPerson !== null ? (
              <Callout tone={aiPicked.details.limit.official ? 'good' : 'warning'} icon={aiPicked.details.limit.official ? 'check' : undefined}>
                <b>{aiPicked.details.limit.official ? 'Leído de las condiciones oficiales' : 'Encontrado fuera de la web oficial'}:</b> {aiPicked.details.limit.perPerson} entradas
                por persona{aiPicked.details.limit.quote ? ` — «${aiPicked.details.limit.quote}»` : ''}
                {aiPicked.details.limit.sourceUrl ? (
                  <>
                    {' '}
                    (
                    <a href={aiPicked.details.limit.sourceUrl} target="_blank" rel="noreferrer">
                      ver
                    </a>
                    )
                  </>
                ) : null}
                . {aiPicked.details.limit.official ? 'Ya está puesto y verificado.' : 'Compruébalo en la web oficial y marca la casilla.'}
                {aiSale && aiSale.limit !== null && aiSale.limit !== aiPicked.details.limit.perPerson ? (
                  <div className="small">
                    En tu fase, «{aiSale.name}», la web dice <b>{aiSale.limit} por persona</b>
                    {toInt(f.limitPerAccount) === aiSale.limit && !overPhase ? ': es el que está puesto.' : '.'}
                  </div>
                ) : null}
              </Callout>
            ) : aiSale && aiSale.limit !== null ? (
              <Callout tone="warning">
                <b>Límite de la fase «{aiSale.name}»:</b> {aiSale.limit} entradas por persona, según la web. Está puesto; compruébalo en las condiciones oficiales y marca la
                casilla.
              </Callout>
            ) : (
              <Callout tone="warning">
                <b>Claude no ha encontrado cuántas entradas se pueden comprar por persona</b> en las condiciones de este evento. Míralo en la web oficial
                {aiPicked.details.url ? (
                  <>
                    {' '}
                    (
                    <a href={aiPicked.details.url} target="_blank" rel="noreferrer">
                      abrir
                    </a>
                    )
                  </>
                ) : null}
                , escríbelo abajo y marca la casilla.
              </Callout>
            )
          ) : null}
          {overPhase ? (
            <Callout tone="warning">
              Ojo: en «{overPhase.name}» la web dice <b>máximo {overPhase.limit} por persona</b> y{' '}
              {overPhase.field === 'perAccount'
                ? `aquí pone ${overPhase.value} por cuenta`
                : `en «Por grupo» pone ${overPhase.value} (lo que puede comprar cada ${GROUP_NOUN[f.limitSemantics]} sumando sus cuentas)`}
              . Pon {overPhase.limit} salvo que lo hayas comprobado en las condiciones oficiales.
            </Callout>
          ) : null}
          {capacity ? <div className="small">{capacity}</div> : null}
          {picked?.event.feed === 'ticketmaster' && picked.event.limit.perCustomer !== null ? (
            <Callout tone="good" icon="check">
              <b>Límite leído de Ticketmaster:</b> «{picked.event.limit.text}». Puesto: {picked.event.limit.perCustomer} por cuenta, contado por titular (Ticketmaster cuenta por
              cliente: mismo nombre, cuenta o tarjeta). Si la página del evento dice otra cosa, cámbialo.
            </Callout>
          ) : picked?.event.feed === 'ticketmaster' ? (
            <Callout tone="warning">
              <b>Ticketmaster no publica el límite de este evento en su API.</b> Míralo en la página del evento
              {picked.event.url ? (
                <>
                  {' '}
                  (
                  <a href={picked.event.url} target="_blank" rel="noreferrer">
                    abrir
                  </a>
                  )
                </>
              ) : null}
              : suele poner «Límite de X entradas por cliente». Escríbelo abajo y marca la casilla.
              {picked.event.limit.text ? <div className="small">Lo que sí dice: «{picked.event.limit.text}»</div> : null}
            </Callout>
          ) : picked?.event.feed === 'football' ? (
            <Callout icon="info">
              El límite lo pone el club para cada partido (en el Real Madrid: condiciones de la venta del partido en realmadrid.com; las entradas de socio son personales). Escríbelo
              abajo y marca la casilla.
            </Callout>
          ) : null}
          <div className="form-grid">
            <div className="field">
              <label htmlFor="evf-lim-acc">Por cuenta</label>
              <input
                id="evf-lim-acc"
                className="input"
                type="number"
                min={1}
                max={100}
                step={1}
                value={f.limitPerAccount}
                onChange={(e) => set('limitPerAccount', e.target.value)}
                aria-invalid={Boolean(errors.limitPerAccount)}
                style={bad('limitPerAccount')}
              />
              <FieldError msg={errors.limitPerAccount} />
            </div>
            <div className="field">
              <label htmlFor="evf-lim-grp">Por grupo</label>
              <input
                id="evf-lim-grp"
                className="input"
                type="number"
                min={1}
                max={100}
                step={1}
                value={perAccountMode ? f.limitPerAccount : f.limitPerGroup}
                disabled={perAccountMode}
                onChange={(e) => set('limitPerGroup', e.target.value)}
                aria-invalid={Boolean(errors.limitPerGroup)}
                style={bad('limitPerGroup')}
              />
              <FieldError msg={errors.limitPerGroup} />
              <span className="hint">{GROUP_HINT[f.limitSemantics]}</span>
            </div>
            <div className="field">
              <label htmlFor="evf-lim-op">Por operación</label>
              <input
                id="evf-lim-op"
                className="input"
                type="number"
                min={1}
                max={1000}
                step={1}
                value={f.limitPerOperation}
                onChange={(e) => set('limitPerOperation', e.target.value)}
                aria-invalid={Boolean(errors.limitPerOperation)}
                style={bad('limitPerOperation')}
              />
              <FieldError msg={errors.limitPerOperation} />
              <span className="hint">Tope total de la operación, sumen lo que sumen las cuentas.</span>
            </div>
            <div className="field">
              <label htmlFor="evf-sem">Cómo cuenta el límite</label>
              <select
                id="evf-sem"
                className="input"
                value={f.limitSemantics}
                onChange={(e) => set('limitSemantics', e.target.value as LimitSemantics)}
                aria-invalid={Boolean(errors.limitSemantics)}
                style={bad('limitSemantics')}
              >
                {LIMIT_SEMANTICS.map((k) => (
                  <option key={k} value={k}>
                    {LIMIT_SEMANTICS_LABEL[k]}
                  </option>
                ))}
              </select>
              <FieldError msg={errors.limitSemantics} />
              <span className="hint">{SEMANTICS_HELP[f.limitSemantics]}</span>
            </div>
          </div>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="evf-lim-src">De dónde salen los límites</label>
              <input
                id="evf-lim-src"
                className="input"
                value={f.limitsSource}
                onChange={(e) => set('limitsSource', e.target.value)}
                placeholder="Enlace a las condiciones oficiales o el texto donde lo dice"
                aria-invalid={Boolean(errors.limitsSource)}
                style={bad('limitsSource')}
              />
              <FieldError msg={errors.limitsSource} />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="evf-lim-notes">Notas sobre los límites (opcional)</label>
              <input
                id="evf-lim-notes"
                className="input"
                value={f.limitsNotes}
                onChange={(e) => set('limitsNotes', e.target.value)}
                placeholder="Ej.: máximo 2 por socio en la fase de socios"
                style={bad('limitsNotes')}
              />
              <FieldError msg={errors.limitsNotes} />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={f.limitsVerified} onChange={(e) => set('limitsVerified', e.target.checked)} />
            <span>He comprobado estos límites en las condiciones oficiales</span>
          </label>
          {!f.limitsVerified ? <Callout tone="warning">Sin verificar no se podrá armar la operación.</Callout> : null}
        </div>
      </div>

      <div className="form-section">
        <h3 className="sign">5 · Dónde queréis las entradas</h3>
        <div className="field" style={{ maxWidth: 520, marginBottom: 14 }}>
          <label htmlFor="evf-per-account">Entradas por cuenta</label>
          <select id="evf-per-account" className="input" value={f.perAccountQty} onChange={(e) => set('perAccountQty', e.target.value)}>
            <option value="">Hasta el límite oficial de cada cuenta</option>
            <option value="1">1 por cuenta (todas las cuentas a la vez: lo más seguro en los grandes partidos)</option>
            <option value="2">2 por cuenta</option>
            <option value="3">3 por cuenta</option>
            <option value="4">4 por cuenta</option>
          </select>
          <span className="hint">
            {f.perAccountQty === '1'
              ? 'Al abrir la venta, cada cuenta va a por 1 entrada en tu 1ª zona; si no hay, a la 2ª y a la 3ª. Así, aunque alguna falle, las demás la consiguen.'
              : 'La compra empieza con esto; se puede cambiar al prepararla.'}
          </span>
        </div>
        {f.saleZones.length > 0 ? (
          <SaleStructure
            zones={f.saleZones}
            venueId={f.venueId && f.venueId !== NEW_VENUE ? f.venueId : null}
            sourceUrl={aiPicked?.details.sources[0] ?? aiPicked?.details.url ?? (f.url.trim() || null)}
          />
        ) : null}
        {f.venueId === NEW_VENUE && f.newVenue ? (
          <div className="row small" style={{ gap: 8 }}>
            <span className="muted">El recinto «{f.newVenue.name}» aún no está en la sala.</span>
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                const id = await createPendingVenue();
                if (id) setF((x) => ({ ...x, venueId: id, newVenue: null }));
              }}
            >
              Crear el recinto ahora para elegir dónde
            </button>
          </div>
        ) : (
          <SeatPicker venueId={f.venueId || null} value={f.seats} onChange={(v) => set('seats', v)} plan={f.plan} onPlan={(p) => set('plan', p)} autoLocate={planFresh} />
        )}
      </div>

      <div className="form-section">
        <div className="stack">
          {outcome && outcome.blocking.length > 0 ? (
            <Callout tone="critical">
              <b>La nota se guardó en {outcome.file}, pero tiene errores y el evento no se ha cargado:</b>
              <IssueList issues={outcome.blocking} />
            </Callout>
          ) : null}
          {outcome?.notApplied ? (
            <Callout tone="warning">
              La nota se guardó en <span className="mono">{outcome.file}</span>, pero el vault tiene errores en otras notas y no se ha recargado el catálogo:
              <IssueList issues={outcome.notApplied} />
              {outcome.totalErrors > outcome.notApplied.length ? <div className="small">y {outcome.totalErrors - outcome.notApplied.length} más.</div> : null}
              <div className="small" style={{ marginTop: 6 }}>
                Cuando los corrijas, el evento aparecerá en la lista. <Link to="/recintos">Ver Recintos · vault</Link>
              </div>
            </Callout>
          ) : null}
          {outcome?.savedId ? (
            <Callout tone="good">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  Evento guardado en <span className="mono">{outcome.file}</span>.
                </span>
                <button type="button" className="btn sm primary" onClick={() => onDone(outcome.savedId)}>
                  <Icon name="check" size={13} /> Listo
                </button>
              </div>
            </Callout>
          ) : null}
          {outcome && outcome.warnings.length > 0 ? (
            <Callout>
              Avisos del vault sobre esta nota (no impiden guardar):
              <IssueList issues={outcome.warnings} />
            </Callout>
          ) : null}
          {serverError ? <Callout tone="critical">{serverError}</Callout> : null}
          {errorCount > 0 ? (
            <div className="small" role="alert" style={{ color: 'var(--critical-ink)' }}>
              Revisa {errorCount === 1 ? 'el campo marcado' : `los ${errorCount} campos marcados`}.
            </div>
          ) : null}
          {lockedCreate && created ? (
            <div className="small muted">
              La nota ya está creada (<span className="mono">{created.file}</span>). Podrás editarla aquí cuando aparezca en la lista, o corrígela en Obsidian.
            </div>
          ) : null}
          <div className="row">
            <button type="button" className="btn primary lg" disabled={busy || lockedCreate} onClick={() => void submit()}>
              <Icon name="check" size={15} /> {busy ? 'Guardando…' : 'Guardar evento'}
            </button>
            <button type="button" className="btn" onClick={() => onDone(null)}>
              {outcome?.savedId || created ? 'Cerrar' : 'Cancelar'}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
