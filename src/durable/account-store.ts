import { DurableObject } from "cloudflare:workers";

import {
  constantTimeHexEqual,
  hashPassword,
  passwordIterations,
  randomHex,
  randomToken,
  sha256Hex,
} from "../crypto";
import type { AdminIdentity, AuthResult, LinkIndexRecord, LoginResult } from "../types";

type AdminRow = {
  email: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

type LinkIndexRow = {
  slug: string;
  target: string;
  description: string | null;
  expires_at: number | null;
  owner: string;
  created_at: number;
  updated_at: number;
};

const ADMIN_IDENTITY = (email: string): AdminIdentity => ({ email, role: "admin" });

export class AccountStore extends DurableObject<Env> {
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
        CREATE TABLE admin (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          password_iterations INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
        CREATE TABLE api_keys (
          token_hash TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER
        );
        CREATE TABLE link_index (
          slug TEXT PRIMARY KEY,
          target TEXT NOT NULL,
          description TEXT,
          expires_at INTEGER,
          owner TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX link_index_created_idx ON link_index(created_at DESC);
      `);
      sql.exec("INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, ?)", Date.now());
    }
  }

  private getAdmin(): AdminRow | undefined {
    return this.ctx.storage.sql.exec<AdminRow>(`
      SELECT email, password_hash, password_salt, password_iterations
      FROM admin WHERE id = 1
    `).toArray()[0];
  }

  async getStatus(): Promise<{ configured: boolean; email: string | null; hasApiKey: boolean }> {
    const admin = this.getAdmin();
    const apiKeyCount = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM api_keys").one().count;
    return { configured: Boolean(admin), email: admin?.email ?? null, hasApiKey: apiKeyCount > 0 };
  }

  async setup(email: string, password: string, now: number, sessionTtlMs: number): Promise<LoginResult> {
    if (this.getAdmin()) return { ok: false, reason: "already_configured" };

    const normalizedEmail = email.trim().toLowerCase();
    const salt = randomHex();
    const passwordHash = await hashPassword(password, salt, passwordIterations);
    // Password hashing yields to the event loop. Re-check before the synchronous
    // insert so two simultaneous first-run requests cannot both complete setup.
    if (this.getAdmin()) return { ok: false, reason: "already_configured" };
    this.ctx.storage.sql.exec(
      `INSERT INTO admin (id, email, password_hash, password_salt, password_iterations, created_at)
       VALUES (1, ?, ?, ?, ?, ?)`,
      normalizedEmail,
      passwordHash,
      salt,
      passwordIterations,
      now,
    );
    return this.createSession(normalizedEmail, now, sessionTtlMs);
  }

  async login(email: string, password: string, now: number, sessionTtlMs: number): Promise<LoginResult> {
    const admin = this.getAdmin();
    if (!admin) return { ok: false, reason: "not_configured" };

    const candidateHash = await hashPassword(password, admin.password_salt, admin.password_iterations);
    const emailMatches = email.trim().toLowerCase() === admin.email;
    const passwordMatches = constantTimeHexEqual(candidateHash, admin.password_hash);
    if (!emailMatches || !passwordMatches) return { ok: false, reason: "invalid_credentials" };

    return this.createSession(admin.email, now, sessionTtlMs);
  }

  private async createSession(email: string, now: number, sessionTtlMs: number): Promise<LoginResult> {
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = now + sessionTtlMs;
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec(
      "INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)",
      tokenHash,
      expiresAt,
      now,
    );
    return { ok: true, token, user: ADMIN_IDENTITY(email), expiresAt };
  }

  async authenticateSession(token: string, now: number): Promise<AuthResult> {
    if (!token) return { authenticated: false };
    const tokenHash = await sha256Hex(token);
    const session = this.ctx.storage.sql.exec<{ token_hash: string }>(
      "SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?",
      tokenHash,
      now,
    ).toArray()[0];
    if (!session) return { authenticated: false };
    const admin = this.getAdmin();
    return admin ? { authenticated: true, user: ADMIN_IDENTITY(admin.email) } : { authenticated: false };
  }

  async authenticateApiKey(token: string, now: number): Promise<AuthResult> {
    if (!token.startsWith("lnk_")) return { authenticated: false };
    const tokenHash = await sha256Hex(token);
    const key = this.ctx.storage.sql.exec<{ token_hash: string }>(
      "SELECT token_hash FROM api_keys WHERE token_hash = ?",
      tokenHash,
    ).toArray()[0];
    if (!key) return { authenticated: false };
    this.ctx.storage.sql.exec("UPDATE api_keys SET last_used_at = ? WHERE token_hash = ?", now, tokenHash);
    const admin = this.getAdmin();
    return admin ? { authenticated: true, user: ADMIN_IDENTITY(admin.email) } : { authenticated: false };
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE token_hash = ?", await sha256Hex(token));
  }

  async generateApiKey(sessionToken: string, now: number): Promise<string | null> {
    const auth = await this.authenticateSession(sessionToken, now);
    if (!auth.authenticated) return null;
    const token = `lnk_${randomToken(36)}`;
    const tokenHash = await sha256Hex(token);
    this.ctx.storage.sql.exec("DELETE FROM api_keys");
    this.ctx.storage.sql.exec(
      "INSERT INTO api_keys (token_hash, created_at, last_used_at) VALUES (?, ?, NULL)",
      tokenHash,
      now,
    );
    return token;
  }

  async revokeApiKeys(sessionToken: string, now: number): Promise<boolean> {
    const auth = await this.authenticateSession(sessionToken, now);
    if (!auth.authenticated) return false;
    this.ctx.storage.sql.exec("DELETE FROM api_keys");
    return true;
  }

  async indexLink(link: LinkIndexRecord): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO link_index (slug, target, description, expires_at, owner, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         target = excluded.target,
         description = excluded.description,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      link.slug,
      link.target,
      link.description,
      link.expiresAt,
      link.owner,
      link.createdAt,
      link.updatedAt,
    );
  }

  async removeLink(slug: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM link_index WHERE slug = ?", slug);
  }

  async listLinks(
    query: string,
    limit: number,
    offset: number,
  ): Promise<{ total: number; links: LinkIndexRecord[] }> {
    const search = query.trim().toLowerCase();
    const pattern = `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const where = search ? "WHERE lower(slug || ' ' || target || ' ' || COALESCE(description, '')) LIKE ? ESCAPE '\\'" : "";
    const parameters = search ? [pattern] : [];
    const total = this.ctx.storage.sql
      .exec<{ count: number }>(`SELECT COUNT(*) AS count FROM link_index ${where}`, ...parameters)
      .one().count;
    const rows = this.ctx.storage.sql.exec<LinkIndexRow>(
      `SELECT slug, target, description, expires_at, owner, created_at, updated_at
       FROM link_index ${where}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...parameters,
      limit,
      offset,
    ).toArray();

    return {
      total,
      links: rows.map((row) => ({
        slug: row.slug,
        target: row.target,
        description: row.description,
        expiresAt: row.expires_at,
        owner: row.owner,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }
}
