import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio (funciona se lance desde la raíz o desde server/). */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Node < 20.12: sin carga automática de .env; se usan las variables del sistema.
  }
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function optional(name: string): string | null {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? null : v.trim();
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : fallback;
}

const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));

const port = int('PORT', 8787);

export const env = {
  port,
  host: str('HOST', '127.0.0.1'),
  vaultDir: resolveFromRoot(str('VAULT_DIR', 'vault')),
  dataDir: resolveFromRoot(str('DATA_DIR', 'data')),
  journalDriver: str('JOURNAL_DRIVER', 'pglite') as 'pglite' | 'memory' | 'postgres',
  databaseUrl: optional('DATABASE_URL'),
  timeZone: str('VAULT_TZ', 'Europe/Madrid'),
  publicBaseUrl: str('PUBLIC_BASE_URL', `http://localhost:${port}`),
  operatorToken: optional('OPERATOR_TOKEN'),
  telegramToken: optional('TELEGRAM_BOT_TOKEN'),
  telegramChatId: optional('TELEGRAM_CHAT_ID'),
  /** Solo para pruebas: servidor que imita la Bot API de Telegram. */
  telegramApiBase: str('TELEGRAM_API_BASE', 'https://api.telegram.org'),
  /** Minutos que tiene una persona para responder una tarea de compra manual. */
  manualTaskMinutes: int('MANUAL_TASK_MINUTES', 30),
  simSeed: int('SIM_SEED', 1),
  dashboardDist: resolveFromRoot(str('DASHBOARD_DIST', 'dashboard/dist')),
  reportsDir: resolveFromRoot(str('REPORTS_DIR', 'reports')),
};
