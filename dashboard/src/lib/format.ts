export { formatClock, formatDuration, formatLatency, formatMoney } from '@to/shared';

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

export function fmtTime(iso: string | null | undefined): string {
  return iso ? timeFmt.format(new Date(iso)) : '—';
}

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}

export function fmtDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '—';
}

/** "hace 3 min" / "en 2 h" */
export function fmtRel(iso: string | null | undefined, now: number): string {
  if (!iso) return '—';
  const diff = Date.parse(iso) - now;
  const a = Math.abs(diff);
  const unit = a < 60_000 ? `${Math.max(1, Math.round(a / 1000))} s` : a < 3_600_000 ? `${Math.round(a / 60_000)} min` : a < 172_800_000 ? `${Math.round(a / 3_600_000)} h` : `${Math.round(a / 86_400_000)} d`;
  return diff >= 0 ? `en ${unit}` : `hace ${unit}`;
}

/** Valor para <input type="datetime-local"> en hora local. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

export const shortHash = (h: string | null | undefined, n = 10) => (h ? h.slice(0, n) : '—');

export function euros(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function parseEuros(value: string): number | null {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
