/**
 * Küçük veritabanı arayüzü. Üretimde gerçek PostgreSQL (`pg`), testlerde ve
 * DATABASE_URL olmayan yerel çalıştırmada PGlite (gerçek Postgres motoru, WASM).
 * Aynı SQL iki tarafta da çalışır.
 */
export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  /** BEGIN ... COMMIT; hata olursa ROLLBACK (atomik işlem) */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'postgres' | 'pglite';
}

export async function createPgDb(url: string): Promise<Db> {
  const { Pool } = await import('pg');
  const needSsl = /sslmode=require/.test(url) || /\.render\.com/.test(url) || process.env.PGSSL === '1';
  const pool = new Pool({
    connectionString: url,
    ssl: needSsl ? { rejectUnauthorized: false } : undefined,
    max: 8,
  });
  pool.on('error', (e) => console.error('[db] boşta bağlantı hatası:', e.message));
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = await c.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
    },
  });
  return {
    kind: 'postgres',
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = await c.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    kind: 'pglite',
    ...wrap(pg),
    tx: (fn) => pg.transaction((t) => fn(wrap(t))),
    close: () => pg.close(),
  };
}

export async function createDbFromEnv(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return createPgDb(url);
  const dir = process.env.PGLITE_DIR ?? './data/pglite';
  console.log(`[db] DATABASE_URL yok: yerel PGlite veritabanı kullanılıyor (${dir})`);
  return createPgliteDb(dir);
}
