/**
 * Email y contraseña de la web oficial de cada cuenta, para que el navegador del bot
 * inicie sesión solo. Se guardan únicamente en este PC (data/credenciales.json, solo
 * legible por el usuario), nunca en el journal ni en el dashboard: la API solo devuelve
 * si existen (`hasSecret`), no su contenido.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface AccountCredentials {
  email: string;
  password: string;
}

export class CredentialStore {
  private readonly file: string;
  private readonly map = new Map<string, AccountCredentials>();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'credenciales.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, AccountCredentials>;
      for (const [id, c] of Object.entries(raw)) if (c && typeof c.email === 'string' && typeof c.password === 'string') this.map.set(id, c);
    } catch {
      // Archivo corrupto: se parte de cero (se reescribe al guardar).
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map), null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Windows no aplica permisos POSIX.
    }
  }

  has(accountId: string): boolean {
    return this.map.has(accountId);
  }

  get(accountId: string): AccountCredentials | null {
    return this.map.get(accountId) ?? null;
  }

  /** Email y contraseña (los dos) o nada. */
  set(accountId: string, credentials: AccountCredentials | null): void {
    if (credentials) this.map.set(accountId, { email: credentials.email.trim(), password: credentials.password });
    else this.map.delete(accountId);
    this.save();
  }

  ids(): string[] {
    return [...this.map.keys()];
  }
}
