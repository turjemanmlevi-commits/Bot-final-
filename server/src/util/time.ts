export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function parseIso(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Fecha ISO inválida: ${value}`);
  return ms;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** Desfase (ms) de una zona IANA respecto a UTC en un instante dado. */
export function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  let fmt = offsetFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(timeZone, fmt);
  }
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000) * 60_000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/**
 * Convierte un valor de fecha del vault a epoch ms. Acepta ISO con zona
 * (`2026-10-09T10:00:00+02:00`, `...Z`) o fecha/hora local sin zona tal y como
 * la escribe Obsidian (`2026-10-09T10:00`, `2026-10-09`), que se interpreta en
 * `timeZone`.
 */
export function parseVaultDate(value: unknown, timeZone: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const s = String(value).trim();
  const m = LOCAL_RE.exec(s);
  if (!m) {
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? null : ms;
  }
  const guess = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
  // El 30 de febrero o las 25:00 no existen: no se mueven a otro día sin avisar.
  const d = new Date(guess);
  const same = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].every((v, i) => v === Number(m[i + 1] ?? 0));
  if (!same) return null;
  const first = guess - timeZoneOffsetMs(guess, timeZone);
  const second = timeZoneOffsetMs(first, timeZone);
  return guess - second;
}
