/**
 * Drivers de persistencia del journal: memoria, PGlite (Postgres embebido en
 * WASM, sin instalar nada) y Postgres (DATABASE_URL).
 */

import { mkdir } from 'node:fs/promises';
import type { AuditEvent } from '@to/shared';

export interface EntityRow {
  kind: string;
  id: string;
  data: unknown;
}

export interface CommitBatch {
  entities: EntityRow[];
  deletes: Array<{ kind: string; id: string }>;
  audit: AuditEvent[];
}

export interface AuditQuery {
  operationId?: string | undefined;
  types?: string[] | undefined;
  afterSeq?: number | undefined;
  beforeSeq?: number | undefined;
  limit?: number | undefined;
  order?: 'asc' | 'desc' | undefined;
}

export type DriverName = 'memory' | 'pglite' | 'postgres';

export interface JournalDriver {
  readonly name: DriverName;
  init(): Promise<void>;
  loadEntities(): Promise<EntityRow[]>;
  maxSeq(): Promise<number>;
  commit(batch: CommitBatch): Promise<void>;
  queryAudit(q: AuditQuery): Promise<AuditEvent[]>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Memoria
// ---------------------------------------------------------------------------

export class MemoryDriver implements JournalDriver {
  readonly name = 'memory' as const;
  private readonly entities = new Map<string, EntityRow>();
  private readonly audit: AuditEvent[] = [];
  /** Permite simular fallos de persistencia en tests y gates. */
  failNextCommits = 0;

  async init(): Promise<void> {}

  async loadEntities(): Promise<EntityRow[]> {
    return [...this.entities.values()].map((r) => ({ ...r, data: structuredClone(r.data) }));
  }

  async maxSeq(): Promise<number> {
    return this.audit.at(-1)?.seq ?? 0;
  }

  async commit(batch: CommitBatch): Promise<void> {
    if (this.failNextCommits > 0) {
      this.failNextCommits--;
      throw new Error('Fallo simulado de persistencia');
    }
    for (const e of batch.entities) this.entities.set(`${e.kind}|${e.id}`, { ...e, data: structuredClone(e.data) });
    for (const d of batch.deletes) this.entities.delete(`${d.kind}|${d.id}`);
    this.audit.push(...batch.audit);
  }

  async queryAudit(q: AuditQuery): Promise<AuditEvent[]> {
    let rows = this.audit.filter(
      (e) =>
        (q.operationId === undefined || e.operationId === q.operationId) &&
        (q.types === undefined || q.types.includes(e.type)) &&
        (q.afterSeq === undefined || e.seq > q.afterSeq) &&
        (q.beforeSeq === undefined || e.seq < q.beforeSeq),
    );
    if (q.order === 'desc') rows = rows.reverse();
    return rows.slice(0, q.limit ?? rows.length);
  }

  async close(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// SQL (PGlite / Postgres)
// ---------------------------------------------------------------------------

interface SqlExecutor {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  seq BIGINT PRIMARY KEY,
  id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  operation_id TEXT,
  correlation_id TEXT,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload JSONB
);
CREATE INDEX IF NOT EXISTS audit_events_op_idx ON audit_events (operation_id, seq);
CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events (type, seq);
`;

const CHUNK = 200;

abstract class SqlDriver implements JournalDriver {
  abstract readonly name: DriverName;
  protected abstract exec(): SqlExecutor;
  protected abstract transaction(fn: (tx: SqlExecutor) => Promise<void>): Promise<void>;
  protected abstract runSchema(sql: string): Promise<void>;
  abstract init(): Promise<void>;
  abstract close(): Promise<void>;

  protected async createSchema(): Promise<void> {
    await this.runSchema(SCHEMA);
  }

  async loadEntities(): Promise<EntityRow[]> {
    const r = await this.exec().query('SELECT kind, id, data FROM entities ORDER BY kind, id');
    return r.rows.map((row) => ({
      kind: String(row.kind),
      id: String(row.id),
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    }));
  }

  async maxSeq(): Promise<number> {
    const r = await this.exec().query('SELECT COALESCE(MAX(seq), 0) AS seq FROM audit_events');
    return Number(r.rows[0]?.seq ?? 0);
  }

  async commit(batch: CommitBatch): Promise<void> {
    await this.transaction(async (tx) => {
      for (let i = 0; i < batch.entities.length; i += CHUNK) {
        const chunk = batch.entities.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const values = chunk.map((e) => {
          params.push(e.kind, e.id, JSON.stringify(e.data));
          const n = params.length;
          return `($${n - 2}, $${n - 1}, $${n}::jsonb, now())`;
        });
        await tx.query(
          `INSERT INTO entities (kind, id, data, updated_at) VALUES ${values.join(', ')}
           ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
          params,
        );
      }
      for (const d of batch.deletes) await tx.query('DELETE FROM entities WHERE kind = $1 AND id = $2', [d.kind, d.id]);
      for (let i = 0; i < batch.audit.length; i += CHUNK) {
        const chunk = batch.audit.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const values = chunk.map((e) => {
          params.push(e.seq, e.id, e.at, e.operationId, e.correlationId, e.type, e.actor, JSON.stringify(e.payload ?? null));
          const n = params.length;
          return `($${n - 7}, $${n - 6}, $${n - 5}::timestamptz, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n}::jsonb)`;
        });
        await tx.query(
          `INSERT INTO audit_events (seq, id, at, operation_id, correlation_id, type, actor, payload) VALUES ${values.join(', ')}
           ON CONFLICT (seq) DO NOTHING`,
          params,
        );
      }
    });
  }

  async queryAudit(q: AuditQuery): Promise<AuditEvent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.operationId !== undefined) {
      params.push(q.operationId);
      where.push(`operation_id = $${params.length}`);
    }
    if (q.types !== undefined && q.types.length > 0) {
      params.push(q.types);
      where.push(`type = ANY($${params.length}::text[])`);
    }
    if (q.afterSeq !== undefined) {
      params.push(q.afterSeq);
      where.push(`seq > $${params.length}`);
    }
    if (q.beforeSeq !== undefined) {
      params.push(q.beforeSeq);
      where.push(`seq < $${params.length}`);
    }
    params.push(Math.min(q.limit ?? 1000, 100_000));
    const sql = `SELECT seq, id, at, operation_id, correlation_id, type, actor, payload FROM audit_events
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY seq ${q.order === 'desc' ? 'DESC' : 'ASC'} LIMIT $${params.length}`;
    const r = await this.exec().query(sql, params);
    return r.rows.map((row) => ({
      seq: Number(row.seq),
      id: String(row.id),
      at: row.at instanceof Date ? row.at.toISOString() : new Date(String(row.at)).toISOString(),
      operationId: (row.operation_id as string | null) ?? null,
      correlationId: (row.correlation_id as string | null) ?? null,
      type: String(row.type),
      actor: String(row.actor),
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    }));
  }
}

interface PGliteLike extends SqlExecutor {
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PgliteDriver extends SqlDriver {
  readonly name = 'pglite' as const;
  private db: PGliteLike | null = null;

  constructor(private readonly dataDir: string) {
    super();
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const mod = await import('@electric-sql/pglite');
    this.db = (await mod.PGlite.create(this.dataDir)) as unknown as PGliteLike;
    await this.createSchema();
  }

  protected exec(): SqlExecutor {
    if (!this.db) throw new Error('PGlite no inicializado');
    return this.db;
  }

  protected async transaction(fn: (tx: SqlExecutor) => Promise<void>): Promise<void> {
    if (!this.db) throw new Error('PGlite no inicializado');
    await this.db.transaction(fn);
  }

  protected async runSchema(sql: string): Promise<void> {
    if (!this.db) throw new Error('PGlite no inicializado');
    await this.db.exec(sql);
  }

  async close(): Promise<void> {
    await this.db?.close();
    this.db = null;
  }
}

interface PgPoolLike extends SqlExecutor {
  connect(): Promise<SqlExecutor & { release(): void }>;
  end(): Promise<void>;
}

export class PostgresDriver extends SqlDriver {
  readonly name = 'postgres' as const;
  private pool: PgPoolLike | null = null;

  constructor(private readonly url: string) {
    super();
  }

  async init(): Promise<void> {
    let mod: { default?: { Pool: new (cfg: { connectionString: string }) => PgPoolLike }; Pool?: new (cfg: { connectionString: string }) => PgPoolLike };
    try {
      const pkg = 'pg';
      mod = (await import(pkg)) as typeof mod;
    } catch {
      throw new Error('Para JOURNAL_DRIVER=postgres instala el paquete: npm install pg -w @to/server');
    }
    const Pool = mod.Pool ?? mod.default?.Pool;
    if (!Pool) throw new Error('No se encontró pg.Pool');
    this.pool = new Pool({ connectionString: this.url });
    await this.createSchema();
  }

  protected exec(): SqlExecutor {
    if (!this.pool) throw new Error('Postgres no inicializado');
    return this.pool;
  }

  protected async transaction(fn: (tx: SqlExecutor) => Promise<void>): Promise<void> {
    if (!this.pool) throw new Error('Postgres no inicializado');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  protected async runSchema(sql: string): Promise<void> {
    await this.exec().query(sql);
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }
}
