import type { OwnedTaso } from '../src/types';
import type { Db } from './db';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  username      text NOT NULL,
  username_lower text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  shooter_uid   text,
  rescued_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS owned_tasos (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id text NOT NULL,
  level      integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 500),
  xp         integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  favorite   boolean NOT NULL DEFAULT false,
  locked     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owned_tasos_user_idx ON owned_tasos(user_id);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
`;

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  shooter_uid: string | null;
  rescued_at: Date | null;
}

export interface Move {
  uid: string;
  from: string;
  to: string;
}

interface TasoRow {
  id: string;
  catalog_id: string;
  level: number;
  xp: number;
  favorite: boolean;
  locked: boolean;
}

const toOwned = (r: TasoRow): OwnedTaso => ({
  uid: r.id,
  catalogId: r.catalog_id,
  level: r.level,
  xp: r.xp,
  favorite: r.favorite,
  locked: r.locked,
});

export type Store = ReturnType<typeof createStore>;

export function createStore(db: Db) {
  return {
    db,

    async migrate() {
      // Tek çalıştırmada birden çok ifade: tek tek gönder (hem pg hem PGlite için güvenli)
      for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
        await db.query(stmt);
      }
    },

    /** Kullanıcıyı ve başlangıç tasolarını TEK işlemde oluşturur. Ad alınmışsa false. */
    async createUser(u: { id: string; username: string; passwordHash: string; starter: OwnedTaso[]; shooterUid: string }) {
      return db.tx(async (q) => {
        const ins = await q.query(
          `INSERT INTO users (id, username, username_lower, password_hash, shooter_uid)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username_lower) DO NOTHING`,
          [u.id, u.username, u.username.toLowerCase(), u.passwordHash, u.shooterUid],
        );
        if (ins.rowCount === 0) return false;
        for (const t of u.starter) {
          await q.query(
            `INSERT INTO owned_tasos (id, user_id, catalog_id, level, xp) VALUES ($1,$2,$3,$4,$5)`,
            [t.uid, u.id, t.catalogId, t.level, t.xp],
          );
        }
        return true;
      });
    },

    async findUserByName(username: string): Promise<UserRow | null> {
      const r = await db.query<UserRow>(`SELECT * FROM users WHERE username_lower = $1`, [username.toLowerCase()]);
      return r.rows[0] ?? null;
    },

    async getUser(id: string): Promise<UserRow | null> {
      const r = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
      return r.rows[0] ?? null;
    },

    async createSession(userId: string, tokenHash: string, ttlMs: number) {
      await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
      await db.query(
        `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + ($3 || ' milliseconds')::interval)`,
        [tokenHash, userId, String(ttlMs)],
      );
    },

    async userIdForSession(tokenHash: string): Promise<string | null> {
      const r = await db.query<{ user_id: string }>(
        `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
        [tokenHash],
      );
      return r.rows[0]?.user_id ?? null;
    },

    async deleteSession(tokenHash: string) {
      await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
    },

    async loadInventory(userId: string): Promise<OwnedTaso[]> {
      const r = await db.query<TasoRow>(
        `SELECT id, catalog_id, level, xp, favorite, locked FROM owned_tasos WHERE user_id = $1 ORDER BY created_at, id`,
        [userId],
      );
      return r.rows.map(toOwned);
    },

    async setShooter(userId: string, uid: string) {
      await db.query(`UPDATE users SET shooter_uid = $2 WHERE id = $1`, [userId, uid]);
    },

    async setRescuedAt(userId: string) {
      await db.query(`UPDATE users SET rescued_at = now() WHERE id = $1`, [userId]);
    },

    async addTasos(userId: string, tasos: OwnedTaso[]) {
      await db.tx(async (q) => {
        for (const t of tasos) {
          await q.query(
            `INSERT INTO owned_tasos (id, user_id, catalog_id, level, xp) VALUES ($1,$2,$3,$4,$5)`,
            [t.uid, userId, t.catalogId, t.level, t.xp],
          );
        }
      });
    },

    /**
     * Tur sonu transferi: hepsi tek işlemde. Bir satırın tek bir user_id'si olduğu için
     * bir taso aynı anda iki envanterde bulunamaz; koşullu UPDATE (eski sahip eşleşmezse
     * değişmez) çift işlemeyi de engeller. Dönen sayı gerçekten taşınan taso adedidir.
     */
    async moveTasos(moves: Move[]): Promise<number> {
      return db.tx(async (q) => {
        let n = 0;
        for (const m of moves) {
          const r = await q.query(
            `UPDATE owned_tasos SET user_id = $3, favorite = false, locked = false WHERE id = $1 AND user_id = $2`,
            [m.uid, m.from, m.to],
          );
          n += r.rowCount;
        }
        return n;
      });
    },

    /**
     * XP yükleme: kaynak tasoları sil + hedefi güncelle, tek işlemde.
     * Kaynaklar kullanıcıya ait ve kilitsiz değilse hiçbir şey yapmaz (false).
     */
    async consumeXp(p: { userId: string; targetUid: string; sourceUids: string[]; level: number; xp: number }): Promise<boolean> {
      return db.tx(async (q) => {
        const src = await q.query(
          `SELECT id FROM owned_tasos WHERE id = ANY($1::text[]) AND user_id = $2 AND locked = false FOR UPDATE`,
          [p.sourceUids, p.userId],
        );
        if (src.rows.length !== p.sourceUids.length) return false;
        const tgt = await q.query(`SELECT id FROM owned_tasos WHERE id = $1 AND user_id = $2 FOR UPDATE`, [p.targetUid, p.userId]);
        if (tgt.rows.length !== 1) return false;
        await q.query(`DELETE FROM owned_tasos WHERE id = ANY($1::text[]) AND user_id = $2`, [p.sourceUids, p.userId]);
        await q.query(`UPDATE owned_tasos SET level = $2, xp = $3 WHERE id = $1`, [p.targetUid, p.level, p.xp]);
        return true;
      });
    },

    async setFlag(userId: string, uid: string, field: 'favorite' | 'locked', value: boolean): Promise<boolean> {
      const col = field === 'favorite' ? 'favorite' : 'locked';
      const r = await db.query(`UPDATE owned_tasos SET ${col} = $3 WHERE id = $1 AND user_id = $2`, [uid, userId, value]);
      return r.rowCount > 0;
    },

    async close() {
      await db.close();
    },
  };
}
