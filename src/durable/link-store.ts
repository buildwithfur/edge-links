import { DurableObject } from "cloudflare:workers";

import type { LinkInput, LinkRecord, LinkStats, LinkUpdate, VisitMetadata, VisitResult } from "../types";

type LinkRow = {
  slug: string;
  target: string;
  description: string | null;
  expires_at: number | null;
  owner: string;
  visit_count: number;
  created_at: number;
  updated_at: number;
};

type CountRow = { value: string; count: number };

export class LinkStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
    });
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    const version = sql
      .exec<{ version: number }>("SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations")
      .one().version;
    if (version < 1) {
      sql.exec(`
        CREATE TABLE link (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          slug TEXT NOT NULL UNIQUE,
          target TEXT NOT NULL,
          description TEXT,
          expires_at INTEGER,
          owner TEXT NOT NULL,
          visit_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE daily_stats (
          day TEXT PRIMARY KEY,
          count INTEGER NOT NULL
        );
        CREATE TABLE dimension_stats (
          kind TEXT NOT NULL,
          value TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (kind, value)
        );
      `);
      sql.exec("INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, ?)", Date.now());
    }
  }

  private getRow(): LinkRow | undefined {
    return this.ctx.storage.sql.exec<LinkRow>(`
      SELECT slug, target, description, expires_at, owner, visit_count, created_at, updated_at
      FROM link WHERE id = 1
    `).toArray()[0];
  }

  private toRecord(row: LinkRow): LinkRecord {
    return {
      slug: row.slug,
      target: row.target,
      description: row.description,
      expiresAt: row.expires_at,
      owner: row.owner,
      visitCount: row.visit_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(input: LinkInput): Promise<{ created: true; link: LinkRecord } | { created: false }> {
    if (this.getRow()) return { created: false };
    this.ctx.storage.sql.exec(
      `INSERT INTO link (id, slug, target, description, expires_at, owner, visit_count, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, 0, ?, ?)`,
      input.slug,
      input.target,
      input.description,
      input.expiresAt,
      input.owner,
      input.createdAt,
      input.createdAt,
    );
    const row = this.getRow();
    if (!row) throw new Error("Link write did not persist");
    return { created: true, link: this.toRecord(row) };
  }

  async get(): Promise<LinkRecord | null> {
    const row = this.getRow();
    return row ? this.toRecord(row) : null;
  }

  async update(owner: string, update: LinkUpdate): Promise<LinkRecord | null> {
    const current = this.getRow();
    if (!current || current.owner !== owner) return null;
    this.ctx.storage.sql.exec(
      `UPDATE link SET target = ?, description = ?, expires_at = ?, updated_at = ? WHERE id = 1`,
      update.target ?? current.target,
      update.description === undefined ? current.description : update.description,
      update.expiresAt === undefined ? current.expires_at : update.expiresAt,
      update.updatedAt,
    );
    const row = this.getRow();
    return row ? this.toRecord(row) : null;
  }

  async remove(owner: string): Promise<boolean> {
    const current = this.getRow();
    if (!current || current.owner !== owner) return false;
    this.ctx.storage.sql.exec("DELETE FROM dimension_stats; DELETE FROM daily_stats; DELETE FROM link;");
    return true;
  }

  async visit(metadata: VisitMetadata, now: number): Promise<VisitResult> {
    const row = this.getRow();
    if (!row) return { status: "missing" };
    if (row.expires_at !== null && row.expires_at <= now) return { status: "expired" };

    const sql = this.ctx.storage.sql;
    sql.exec("UPDATE link SET visit_count = visit_count + 1 WHERE id = 1");
    sql.exec(
      `INSERT INTO daily_stats (day, count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET count = count + 1`,
      metadata.day,
    );
    for (const [kind, value] of [
      ["country", metadata.country],
      ["browser", metadata.browser],
      ["referrer", metadata.referrer],
    ] as const) {
      sql.exec(
        `INSERT INTO dimension_stats (kind, value, count) VALUES (?, ?, 1)
         ON CONFLICT(kind, value) DO UPDATE SET count = count + 1`,
        kind,
        value,
      );
    }
    return { status: "active", target: row.target };
  }

  async getStats(owner: string): Promise<LinkStats | null> {
    const row = this.getRow();
    if (!row || row.owner !== owner) return null;
    const daily = this.ctx.storage.sql
      .exec<{ day: string; count: number }>(`
        SELECT day, count FROM (
          SELECT day, count FROM daily_stats ORDER BY day DESC LIMIT 366
        ) ORDER BY day ASC
      `)
      .toArray();
    const dimensions = this.ctx.storage.sql
      .exec<{ kind: string; value: string; count: number }>(
        "SELECT kind, value, count FROM dimension_stats ORDER BY count DESC",
      )
      .toArray();
    const byKind = (kind: string): CountRow[] =>
      dimensions.filter((item) => item.kind === kind).slice(0, 12).map(({ value, count }) => ({ value, count }));
    return {
      total: row.visit_count,
      daily,
      countries: byKind("country"),
      browsers: byKind("browser"),
      referrers: byKind("referrer"),
    };
  }
}
