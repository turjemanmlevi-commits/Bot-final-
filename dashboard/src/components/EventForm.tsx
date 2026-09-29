import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import {
  EventNoteInputSchema,
  LIMIT_SEMANTICS,
  LIMIT_SEMANTICS_LABEL,
  LOCAL_DATETIME_RE,
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
  type VaultIssue,
} from '@to/shared';
import { Api, ApiError } from '../lib/api';
import { fmtRel } from '../lib/format';
import { useAction, useNow } from '../lib/hooks';
import { useLive } from '../lib/store';
import { Icon } from './Icon';
import { EventSourcePanel, fmtMadrid } from './OfficialEventPicker';
import { Callout, Card } from './ui';

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
}

/** Valor del selector de recinto para «recinto nuevo, se crea al guardar». */
const NEW_VENUE = '__nuevo__';

/** Estructura orientativa de un recinto nuevo según su nombre (se revisa después con el plano oficial). */
function guessLayout(name: string): string {
  const n = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (/estadi|stadium|camp nou|campo de futbol|coliseum/.test(n)) return 'Tribuna\nPreferencia\nFondo Norte\nFondo Sur';
  if (/teatro|teatre|auditori|opera|gran casino|sala /.test(n)) return 'Patio de butacas\nAnfiteatro';
  if (/arena|palacio|pabellon|palau|center|centre|multiusos|coliseo|toros|velodromo|wizink/.test(n)) return 'Pista (de pie)\nGrada baja\nGrada alta';
  if (/festival|recinto|parque|parc|ferial|playa|explanada|ifema|fira/.test(n)) return 'General (de pie)';
  return 'General';
}

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
}: {
  info: { page: PageImport; index: number; sale: string | null };
  /** sale = undefined: la fase por defecto (la venta general próxima). */
  onChoose: (index: number, sale: string | null | undefined) => void;
  onDismiss: () => void;
  newVenue: { name: string; city: string | null } | null;
}) {
  const ev = info.page.events[info.index];
  if (!ev) return null;
  const got: string[] = [];
  const missing: string[] = [];
  (ev.name ? got : missing).push('nombre');
  (ev.startsAtLocal ? got : missing).push(ev.startsAtLocal && ev.timeTBA ? 'fecha (sin hora)' : 'fecha y hora');
  (ev.venueId || newVenue ? got : missing).push('recinto');
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
          {missing.length > 0 ? (
            <b>
              No aparece en la página: {missing.join(', ')}
              {missing.includes('apertura de la venta') ? ' (si aún no está anunciada, ponla cuando salga: la vigilancia te lo recuerda)' : ''}. Complétalo abajo.
            </b>
          ) : (
            'Revisa y guarda.'
          )}
        </div>
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
                <button key={x.name} type="button" className={`btn sm ${info.sale === x.name ? 'primary' : ''}`} onClick={() => onChoose(info.index, x.name)}>
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

// ---------------------------------------------------------------------------

export function EventForm({ initial, imported, onDone }: { initial?: CatalogEvent; imported?: PageImport | null; onDone: (eventId: string | null) => void }) {
  const s = useLive();
  const now = useNow(30_000);
  const { run, busy } = useAction();
  const providers = useMemo(() => sortProviders(s.providerAuthorizations), [s.providerAuthorizations]);
  const venues = s.vault?.venues ?? [];
  // Un evento nuevo empieza por «Dónde se vende» (sin nada elegido).
  const [f, setF] = useState<FormState>(() => (initial ? fromEvent(initial) : blank('')));
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
        layout: guessLayout(nv.name),
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
  const watchFrom = anchorEpoch === null ? null : anchorEpoch - (Number(f.watchDaysBefore) || 0) * 86_400_000;
  const errorCount = Object.keys(errors).length;
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
            />
          ) : null}
          <EventSourcePanel
            key={f.providerId}
            provider={provider ?? null}
            linked={f.officialFeed ? { feed: f.officialFeed, id: f.officialId, name: picked?.event.name ?? (initial?.officialId === f.officialId ? initial.name : null), sale: f.officialSale } : null}
            onPick={pickOfficial}
            onUnlink={unlinkOfficial}
          />
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
                  : picked || fromPage
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
              <select id="evf-watch" className="input" value={f.watchDaysBefore} onChange={(e) => set('watchDaysBefore', e.target.value)}>
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
        <h3 className="sign">5 · Notas</h3>
        {creating ? (
          <div className="field">
            <label htmlFor="evf-notes">Notas (opcional)</label>
            <textarea
              id="evf-notes"
              className="input"
              rows={4}
              value={f.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Fases de venta, requisitos, precios… Se guardan en el cuerpo de la nota de Obsidian."
              style={bad('notes')}
            />
            <FieldError msg={errors.notes} />
          </div>
        ) : (
          <div className="small muted">Las notas del cuerpo se editan en Obsidian ({target?.sourceFile}).</div>
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
