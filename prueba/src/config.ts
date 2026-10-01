/**
 * Configuración de la prueba local. Se lee de `prueba/.env` o del `.env` de la raíz
 * (ambos ignorados por git). Nada de esto se sube al repositorio.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const REPO_DIR = path.resolve(PACKAGE_DIR, '..');

export interface PruebaConfig {
  host: string;
  port: number;
  /** Perfil persistente del navegador del bot: aquí queda guardada tu sesión del Real Madrid. */
  profileDir: string;
  capturesDir: string;
  telegram: { token: string | null; chatId: string | null; apiBase: string };
  /** Opcional: si no se rellenan, el login lo haces tú en la ventana del bot (recomendado). */
  account: { email: string | null; password: string | null };
  defaults: {
    /** Vacía = el bot entra en el canal del femenino y elige el primer partido a la venta. */
    realEventUrl: string;
    quantity: number;
    zones: string[];
    maxUnitPriceEur: number | null;
    /** Exigir asientos seguidos en la misma fila. */
    contiguous: boolean;
    /** Si no hay tantas, aceptar menos entradas. */
    fallbackFewer: boolean;
  };
  /** Cuánto espera el bot a que resuelvas tú un login, CAPTCHA o cola. */
  humanWaitMs: number;
  /** Cuánto se mantiene la decisión abierta si la web no informa de caducidad del carrito. */
  cartHoldMs: number;
}

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Las variables ya definidas en el entorno tienen prioridad.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function str(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

function num(name: string, fallback: number): number {
  const v = str(name);
  if (v === null) return fallback;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`${name} debe ser un número (valor: "${v}")`);
  return n;
}

export function loadConfig(): PruebaConfig {
  loadDotEnv(path.join(PACKAGE_DIR, '.env'));
  loadDotEnv(path.join(REPO_DIR, '.env'));

  const dataDir = path.join(REPO_DIR, 'data', 'prueba');
  const profileDir = path.join(dataDir, 'perfil-navegador');
  const capturesDir = path.join(dataDir, 'capturas');
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(capturesDir, { recursive: true });

  const maxPrice = str('PRUEBA_PRECIO_MAX');
  return {
    host: str('PRUEBA_HOST') ?? '127.0.0.1',
    port: num('PRUEBA_PORT', 3000),
    profileDir,
    capturesDir,
    telegram: {
      token: str('TELEGRAM_BOT_TOKEN'),
      chatId: str('TELEGRAM_CHAT_ID'),
      apiBase: str('TELEGRAM_API_BASE') ?? 'https://api.telegram.org',
    },
    account: { email: str('RM_EMAIL'), password: str('RM_PASSWORD') },
    defaults: {
      realEventUrl: str('PRUEBA_URL_EVENTO') ?? '',
      quantity: num('PRUEBA_CANTIDAD', 3),
      zones: (str('PRUEBA_ZONAS') ?? '')
        .split(',')
        .map((z) => z.trim())
        .filter(Boolean),
      maxUnitPriceEur: maxPrice === null ? null : num('PRUEBA_PRECIO_MAX', 0),
      contiguous: (str('PRUEBA_JUNTOS') ?? '1') !== '0',
      fallbackFewer: (str('PRUEBA_ACEPTAR_MENOS') ?? '1') !== '0',
    },
    humanWaitMs: num('PRUEBA_ESPERA_HUMANO_MIN', 5) * 60_000,
    cartHoldMs: num('PRUEBA_RETENCION_CARRITO_MIN', 10) * 60_000,
  };
}

/** Guarda (o actualiza) valores en prueba/.env para que se mantengan entre arranques. */
export function saveEnvValues(values: Record<string, string>): void {
  const file = process.env['PRUEBA_ENV_FILE'] ?? path.join(PACKAGE_DIR, '.env');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
    process.env[key] = value;
  }
  writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'));
}
