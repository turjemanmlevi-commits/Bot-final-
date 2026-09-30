import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvInto } from './util/envfile';

/** Raíz del repositorio (funciona se lance desde la raíz o desde server/). */
export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Archivo de configuración (.env en la raíz; ENV_FILE para usar otro, p. ej. en ensayos). */
export const ENV_FILE = process.env.ENV_FILE?.trim() ? path.resolve(process.env.ENV_FILE.trim()) : path.join(REPO_ROOT, '.env');
/** Plantilla con la que se crea el .env si no existe. */
export const ENV_TEMPLATE = path.join(REPO_ROOT, '.env.example');

/**
 * Cómo fue la lectura del .env (se avisa al arrancar): variables de entorno del
 * sistema con otro valor que el .env ha tapado y, si no se pudo leer, por qué.
 */
export const ENV_LOAD: { shadowed: string[]; error: string | null } = { shadowed: [], error: null };

// Se lee se guarde como se guarde en el Bloc de notas (con BOM, en UTF-16…).
const envFile = ENV_FILE;
if (existsSync(envFile)) {
  try {
    ENV_LOAD.shadowed = loadEnvInto(envFile);
  } catch (err) {
    // .env ilegible: se usan las variables del sistema.
    ENV_LOAD.error = (err as Error).message;
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

/**
 * Carpeta de datos (base de datos PGlite). Si el proyecto está dentro de OneDrive
 * en Windows, va a %LOCALAPPDATA%: la sincronización de OneDrive bloquea los
 * archivos de la base de datos y puede impedir que arranque. Las versiones
 * anteriores la guardaban en la del proyecto (`legacy`): de ahí se copia.
 */
function dataDir(): { dir: string; legacy: string | null } {
  const configured = process.env.DATA_DIR?.trim();
  if (configured && configured !== 'data') return { dir: resolveFromRoot(configured), legacy: null };
  const local = process.env.LOCALAPPDATA?.trim();
  if (process.platform === 'win32' && local && /onedrive/i.test(REPO_ROOT)) return { dir: path.join(local, 'TicketOrchestrator', 'data'), legacy: resolveFromRoot('data') };
  return { dir: resolveFromRoot('data'), legacy: null };
}

const data = dataDir();

const port = int('PORT', 8787);

export const env = {
  port,
  host: str('HOST', '127.0.0.1'),
  vaultDir: resolveFromRoot(str('VAULT_DIR', 'vault')),
  dataDir: data.dir,
  /** Carpeta de datos de las versiones anteriores (proyecto en OneDrive): sus datos se copian a dataDir la primera vez. */
  legacyDataDir: data.legacy,
  journalDriver: str('JOURNAL_DRIVER', 'pglite') as 'pglite' | 'memory' | 'postgres',
  databaseUrl: optional('DATABASE_URL'),
  timeZone: str('VAULT_TZ', 'Europe/Madrid'),
  publicBaseUrl: str('PUBLIC_BASE_URL', `http://localhost:${port}`),
  operatorToken: optional('OPERATOR_TOKEN'),
  telegramToken: optional('TELEGRAM_BOT_TOKEN'),
  telegramChatId: optional('TELEGRAM_CHAT_ID'),
  /** Avisos automáticos solo cuando toda la cantidad está verificada en carrito. */
  telegramCartOnly: str('TELEGRAM_CART_ONLY', 'true').toLowerCase() !== 'false',
  /** Solo para pruebas: servidor que imita la Bot API de Telegram. */
  telegramApiBase: str('TELEGRAM_API_BASE', 'https://api.telegram.org'),
  /** Clave gratuita de la Discovery API de Ticketmaster (developer.ticketmaster.com → Consumer Key). */
  ticketmasterKey: optional('TICKETMASTER_API_KEY'),
  /** Token gratuito de football-data.org (partidos de LaLiga y Champions). */
  footballDataToken: optional('FOOTBALL_DATA_TOKEN'),
  /** Clave de la API de Claude (platform.claude.com → API keys): busca y lee los eventos de cada web de venta. */
  anthropicKey: optional('ANTHROPIC_API_KEY'),
  /** Modelo de Claude fijo (opcional); sin él, el Opus más reciente de la cuenta. */
  anthropicModel: optional('ANTHROPIC_MODEL'),
  /** Solo para pruebas: servidores que imitan esas APIs. */
  anthropicApiBase: optional('ANTHROPIC_API_BASE'),
  ticketmasterApiBase: str('TICKETMASTER_API_BASE', 'https://app.ticketmaster.com'),
  footballApiBase: str('FOOTBALL_DATA_API_BASE', 'https://api.football-data.org'),
  /** Minutos que tiene una persona para responder una tarea de compra manual. */
  manualTaskMinutes: int('MANUAL_TASK_MINUTES', 30),
  simSeed: int('SIM_SEED', 1),
  dashboardDist: resolveFromRoot(str('DASHBOARD_DIST', 'dashboard/dist')),
  reportsDir: resolveFromRoot(str('REPORTS_DIR', 'reports')),
};
