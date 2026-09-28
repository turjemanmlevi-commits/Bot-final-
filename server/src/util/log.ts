type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let minLevel: Level = (process.env.LOG_LEVEL as Level | undefined) ?? 'info';
let silent = false;

export function setLogLevel(level: Level): void {
  minLevel = level;
}

/** Silencia el log (tests, gates y bench). */
export function setLogSilent(value: boolean): void {
  silent = value;
}

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
  if (silent || ORDER[level] < ORDER[minLevel]) return;
  const time = new Date().toISOString().slice(11, 23);
  const extra = data && Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
  const line = `${time} ${level.toUpperCase().padEnd(5)} ${msg}${extra}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
};
