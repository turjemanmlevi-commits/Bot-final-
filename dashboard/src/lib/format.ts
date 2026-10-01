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

/** Importe en unidades menores como texto para un campo en castellano: 12000 → "120,00". */
export function eurosEs(minor: number): string {
  return (minor / 100).toFixed(2).replace('.', ',');
}

/**
 * Lee un importe escrito a mano y lo devuelve en céntimos, o null si no es un
 * número claro. Acepta coma o punto decimal ('119,50', '119.50'), separador de
 * miles ('1.234,50', '1,234.50'), el símbolo del euro y espacios ('€ 95').
 * El último separador seguido de 1 o 2 cifras es el decimal; con 3 cifras detrás
 * es de miles ('1.234' = 1234). Vacío, negativos o texto → null.
 */
export function parseEuros(value: string): number | null {
  let s = value
    .replace(/€|eur(?:os?)?/gi, '')
    .replace(/[\s\u00a0\u202f']/g, '');
  if (s.endsWith(',') || s.endsWith('.')) s = s.slice(0, -1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dec = /[.,](\d{1,2})$/.exec(s);
  let int = dec ? s.slice(0, dec.index) : s;
  const decimals = dec?.[1] ?? '';
  if (int === '') int = '0';
  if (!/^\d+$/.test(int)) {
    // Parte entera con separador de miles: grupos de 3 cifras y un único tipo de separador,
    // distinto del decimal ('1.234.50' o '1,234,56' son ambiguos).
    if (!/^\d{1,3}(?:[.,]\d{3})+$/.test(int)) return null;
    const seps = new Set(int.replace(/\d/g, ''));
    if (seps.size !== 1) return null;
    if (dec && seps.has(s.charAt(dec.index))) return null;
    int = int.replace(/[.,]/g, '');
  }
  const cents = Number(int) * 100 + Number(decimals.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Cuenta atrás en segundos enteros: "3 min 12 s", "45 s", "1 h 05 min". */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, '0')} s`;
  return `${sec} s`;
}
