import { DurableObject } from "cloudflare:workers";

export class RateLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS requests (
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS requests_timestamp_idx ON requests(timestamp);
      `);
    });
  }

  async check(limit: number, windowMs: number, now: number): Promise<{ allowed: boolean; retryAfter: number }> {
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM requests WHERE timestamp <= ?", now - windowMs);
    const rows = sql.exec<{ count: number; oldest: number | null }>(
      "SELECT COUNT(*) AS count, MIN(timestamp) AS oldest FROM requests",
    ).one();
    if (rows.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil(((rows.oldest ?? now) + windowMs - now) / 1_000));
      return { allowed: false, retryAfter };
    }
    sql.exec("INSERT INTO requests (timestamp) VALUES (?)", now);
    return { allowed: true, retryAfter: 0 };
  }
}
