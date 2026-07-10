import { AccountStore } from "./durable/account-store";
import { LinkStore } from "./durable/link-store";
import { RateLimiter } from "./durable/rate-limiter";
import type {
  AdminIdentity,
  LinkIndexRecord,
  LinkInput,
  LinkRecord,
  LinkUpdate,
  VisitMetadata,
} from "./types";

export { AccountStore, LinkStore, RateLimiter };

// v2 rotates the empty pre-launch singleton after the initial PBKDF2 setup
// failure, ensuring Cloudflare instantiates it with the corrected runtime code.
const OWNER = "primary-v2";
const SESSION_COOKIE = "shortener_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_JSON_BYTES = 32 * 1_024;
const MAX_LINKS_PER_PAGE = 25;
const RESERVED_SLUGS = new Set([
  "api",
  "assets",
  "admin",
  "app",
  "favicon",
  "health",
  "index",
  "login",
  "logout",
  "manifest",
  "robots",
  "settings",
  "stats",
]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string>,
  ) {
    super(message);
  }
}

type RequestAuth = {
  user: AdminIdentity;
  mode: "session" | "api-key";
  token: string;
};

function account(env: Env): DurableObjectStub<AccountStore> {
  return env.ACCOUNT.getByName(OWNER);
}

function linkStore(env: Env, slug: string): DurableObjectStub<LinkStore> {
  return env.LINKS.getByName(slug);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new HttpError(413, "Request body is too large.");
  }
  if (!request.body) throw new HttpError(400, "A JSON request body is required.");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_JSON_BYTES) throw new HttpError(413, "Request body is too large.");
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
  if (!isRecord(value)) throw new HttpError(400, "Request body must be a JSON object.");
  return value;
}

function requiredString(body: Record<string, unknown>, key: string, label: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") throw new HttpError(400, `${label} is required.`);
  return value.trim();
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return email;
}

function validatePassword(value: string): string {
  if (value.length < 12) throw new HttpError(400, "Password must be at least 12 characters.");
  if (value.length > 1_024) throw new HttpError(400, "Password is too long.");
  return value;
}

function normalizeTarget(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new HttpError(400, "Target URL is required.");
  if (value.length > 2_048) throw new HttpError(400, "Target URL is too long.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HttpError(400, "Target must be a valid absolute URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "Only http:// and https:// target URLs are supported.");
  }
  if (url.username || url.password) throw new HttpError(400, "Target URLs cannot contain credentials.");
  return url.href;
}

function normalizeDescription(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, "Description must be text.");
  const description = value.trim();
  if (description.length > 280) throw new HttpError(400, "Description cannot exceed 280 characters.");
  return description || null;
}

function normalizeExpiry(value: unknown, now: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new HttpError(400, "Expiration date is invalid.");
  if (timestamp <= now) throw new HttpError(400, "Expiration date must be in the future.");
  return timestamp;
}

function normalizeSlug(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Custom slug must be text.");
  const slug = value.trim().toLowerCase();
  if (slug.length < 2 || slug.length > 48) throw new HttpError(400, "Custom slug must be 2–48 characters.");
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(slug)) {
    throw new HttpError(400, "Custom slug can use lowercase letters, numbers, hyphens, and underscores.");
  }
  if (RESERVED_SLUGS.has(slug)) throw new HttpError(400, "That slug is reserved by the application.");
  return slug;
}

function randomSlug(length: number): string {
  const alphabet = "abcdefghkmnpqrstuvwxyz23456789";
  const output: string[] = [];
  const bytes = new Uint8Array(Math.max(length * 2, 16));
  while (output.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= 224) continue;
      output.push(alphabet[byte % alphabet.length] ?? "x");
      if (output.length === length) break;
    }
  }
  return output.join("");
}

function publicOrigin(request: Request, env: Env): string {
  const configured = env.PUBLIC_ORIGIN.trim().replace(/\/$/u, "");
  if (!configured) return new URL(request.url).origin;
  try {
    const url = new URL(configured);
    return url.origin;
  } catch {
    return new URL(request.url).origin;
  }
}

function configuredHostname(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function configuredRootRedirect(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function toIndexRecord(link: LinkRecord): LinkIndexRecord {
  return {
    slug: link.slug,
    target: link.target,
    description: link.description,
    expiresAt: link.expiresAt,
    owner: link.owner,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

function serializeLink(link: LinkRecord, request: Request, env: Env): Record<string, unknown> {
  const shortUrl = `${publicOrigin(request, env)}/${link.slug}`;
  return {
    id: link.slug,
    address: link.slug,
    slug: link.slug,
    link: shortUrl,
    target: link.target,
    description: link.description,
    expire_in: link.expiresAt === null ? null : new Date(link.expiresAt).toISOString(),
    expiresAt: link.expiresAt,
    visit_count: link.visitCount,
    visitCount: link.visitCount,
    created_at: new Date(link.createdAt).toISOString(),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function makeSessionCookie(request: Request, token: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

async function authenticate(request: Request, env: Env): Promise<RequestAuth | null> {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice(7).trim();
    const result = await account(env).authenticateApiKey(token, Date.now());
    return result.authenticated ? { user: result.user, mode: "api-key", token } : null;
  }
  const token = parseCookies(request).get(SESSION_COOKIE) ?? "";
  const result = await account(env).authenticateSession(token, Date.now());
  return result.authenticated ? { user: result.user, mode: "session", token } : null;
}

async function requireAuth(request: Request, env: Env): Promise<RequestAuth> {
  const auth = await authenticate(request, env);
  if (!auth) throw new HttpError(401, "Authentication required.");
  return auth;
}

async function enforceRateLimit(
  request: Request,
  env: Env,
  scope: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const result = await env.RATE_LIMITS.getByName(`${scope}:${ip}`).check(limit, windowMs, Date.now());
  if (!result.allowed) {
    throw new HttpError(429, `Too many attempts. Try again in ${result.retryAfter} seconds.`, {
      retryAfter: String(result.retryAfter),
    });
  }
}

function browserFromUserAgent(userAgent: string): string {
  if (/edg\//iu.test(userAgent)) return "Edge";
  if (/opr\//iu.test(userAgent)) return "Opera";
  if (/firefox\//iu.test(userAgent)) return "Firefox";
  if (/chrome\//iu.test(userAgent)) return "Chrome";
  if (/safari\//iu.test(userAgent)) return "Safari";
  return "Other";
}

function referrerFromRequest(request: Request): string {
  const referrer = request.headers.get("referer");
  if (!referrer) return "Direct";
  try {
    return new URL(referrer).hostname.slice(0, 120) || "Direct";
  } catch {
    return "Other";
  }
}

function visitMetadata(request: Request, now: number): VisitMetadata {
  const country = typeof request.cf?.country === "string" ? request.cf.country : "Unknown";
  return {
    day: new Date(now).toISOString().slice(0, 10),
    country: country.slice(0, 64),
    browser: browserFromUserAgent(request.headers.get("user-agent") ?? "").slice(0, 64),
    referrer: referrerFromRequest(request),
  };
}

function securityHeaders(headers = new Headers()): Headers {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  return headers;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = securityHeaders(new Headers(init.headers));
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function secureResponse(response: Response): Response {
  const headers = securityHeaders(new Headers(response.headers));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function statusPage(status: number, title: string, message: string, siteName: string): Response {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ${escapeHtml(siteName)}</title><link rel="stylesheet" href="/assets/styles.css"></head><body><main class="status-page"><a class="brand" href="/"><span class="brand-mark">↗/</span><span>${escapeHtml(siteName)}</span></a><section><p class="eyebrow">${status}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="button primary" href="/">Back to dashboard</a></section></main></body></html>`;
  return new Response(body, {
    status,
    headers: securityHeaders(new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })),
  });
}

async function handleAuthRoutes(request: Request, env: Env, path: string): Promise<Response | null> {
  if (request.method === "GET" && path === "/api/auth/status") {
    const [status, auth] = await Promise.all([account(env).getStatus(), authenticate(request, env)]);
    return json({
      configured: status.configured,
      needsSetup: !status.configured,
      authenticated: Boolean(auth),
      user: auth?.user ?? null,
      hasApiKey: auth ? status.hasApiKey : false,
    });
  }

  if (request.method === "POST" && path === "/api/auth/setup") {
    await enforceRateLimit(request, env, "setup", 5, 60 * 60 * 1_000);
    const body = await readJsonObject(request);
    const email = normalizeEmail(requiredString(body, "email", "Email"));
    const password = validatePassword(requiredString(body, "password", "Password"));
    const result = await account(env).setup(email, password, Date.now(), SESSION_TTL_MS);
    if (!result.ok) throw new HttpError(409, "This shortener has already been configured.");
    return json(
      { authenticated: true, user: result.user },
      { status: 201, headers: { "Set-Cookie": makeSessionCookie(request, result.token, SESSION_TTL_MS / 1_000) } },
    );
  }

  if (request.method === "POST" && path === "/api/auth/login") {
    await enforceRateLimit(request, env, "login", 8, 10 * 60 * 1_000);
    const body = await readJsonObject(request);
    const email = normalizeEmail(requiredString(body, "email", "Email"));
    const password = requiredString(body, "password", "Password");
    const result = await account(env).login(email, password, Date.now(), SESSION_TTL_MS);
    if (!result.ok) throw new HttpError(401, "Email or password is incorrect.");
    return json(
      { authenticated: true, user: result.user },
      { headers: { "Set-Cookie": makeSessionCookie(request, result.token, SESSION_TTL_MS / 1_000) } },
    );
  }

  if (request.method === "POST" && path === "/api/auth/logout") {
    const token = parseCookies(request).get(SESSION_COOKIE) ?? "";
    await account(env).logout(token);
    return json(
      { authenticated: false },
      { headers: { "Set-Cookie": makeSessionCookie(request, "", 0) } },
    );
  }

  if (request.method === "POST" && path === "/api/auth/apikey") {
    const token = parseCookies(request).get(SESSION_COOKIE) ?? "";
    const apiKey = await account(env).generateApiKey(token, Date.now());
    if (!apiKey) throw new HttpError(401, "A dashboard session is required.");
    return json({ apiKey });
  }

  if (request.method === "DELETE" && path === "/api/auth/apikey") {
    const token = parseCookies(request).get(SESSION_COOKIE) ?? "";
    const revoked = await account(env).revokeApiKeys(token, Date.now());
    if (!revoked) throw new HttpError(401, "A dashboard session is required.");
    return json({ revoked: true });
  }

  return null;
}

async function createLink(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);
  await enforceRateLimit(request, env, "create-link", 60, 60 * 1_000);
  const body = await readJsonObject(request);
  const target = normalizeTarget(body.target);
  const description = normalizeDescription(body.description);
  const now = Date.now();
  const expiresAt = normalizeExpiry(body.expiresAt ?? body.expire_in, now);
  const customSlug = body.slug ?? body.customurl;
  const requestedSlug = customSlug === undefined || customSlug === null || customSlug === "" ? null : normalizeSlug(customSlug);
  const configuredLength = Number.parseInt(env.LINK_LENGTH, 10);
  const linkLength = Number.isFinite(configuredLength) ? Math.min(16, Math.max(4, configuredLength)) : 6;

  for (let attempt = 0; attempt < (requestedSlug ? 1 : 8); attempt += 1) {
    const slug = requestedSlug ?? randomSlug(linkLength);
    const input: LinkInput = { slug, target, description, expiresAt, owner: OWNER, createdAt: now };
    const stub = linkStore(env, slug);
    const result = await stub.create(input);
    if (!result.created) {
      if (requestedSlug) throw new HttpError(409, "That custom slug is already in use.");
      continue;
    }
    try {
      await account(env).indexLink(toIndexRecord(result.link));
    } catch (error) {
      await stub.remove(OWNER);
      throw error;
    }
    return json(serializeLink(result.link, request, env), { status: 201 });
  }
  throw new HttpError(503, "Could not allocate a unique short link. Please try again.");
}

async function listLinks(request: Request, env: Env): Promise<Response> {
  await requireAuth(request, env);
  const url = new URL(request.url);
  const limit = Math.min(MAX_LINKS_PER_PAGE, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
  const offset = Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? url.searchParams.get("skip") ?? "0", 10) || 0);
  const query = (url.searchParams.get("q") ?? url.searchParams.get("search") ?? "").slice(0, 120);
  const index = await account(env).listLinks(query, limit, offset);
  const records = await Promise.all(index.links.map((item) => linkStore(env, item.slug).get()));
  const data: Array<Record<string, unknown>> = [];
  for (const record of records) {
    if (record !== null) data.push(serializeLink(record, request, env));
  }
  return json({ total: index.total, limit, skip: offset, data });
}

async function handleLinkItem(request: Request, env: Env, path: string): Promise<Response | null> {
  const statsMatch = path.match(/^\/api\/links\/([^/]+)\/stats$/u);
  if (request.method === "GET" && statsMatch) {
    await requireAuth(request, env);
    const slug = normalizeSlug(decodeURIComponent(statsMatch[1] ?? ""));
    const stats = await linkStore(env, slug).getStats(OWNER);
    if (!stats) throw new HttpError(404, "Link was not found.");
    return json(stats);
  }

  const itemMatch = path.match(/^\/api\/links\/([^/]+)$/u);
  if (!itemMatch) return null;
  const slug = normalizeSlug(decodeURIComponent(itemMatch[1] ?? ""));

  if (request.method === "PATCH") {
    await requireAuth(request, env);
    const body = await readJsonObject(request);
    const now = Date.now();
    const update: LinkUpdate = { updatedAt: now };
    if (Object.hasOwn(body, "target")) update.target = normalizeTarget(body.target);
    if (Object.hasOwn(body, "description")) update.description = normalizeDescription(body.description);
    if (Object.hasOwn(body, "expiresAt") || Object.hasOwn(body, "expire_in")) {
      update.expiresAt = normalizeExpiry(body.expiresAt ?? body.expire_in, now);
    }
    if (update.target === undefined && update.description === undefined && update.expiresAt === undefined) {
      throw new HttpError(400, "Provide at least one field to update.");
    }
    const updated = await linkStore(env, slug).update(OWNER, update);
    if (!updated) throw new HttpError(404, "Link was not found.");
    await account(env).indexLink(toIndexRecord(updated));
    return json(serializeLink(updated, request, env));
  }

  if (request.method === "DELETE") {
    await requireAuth(request, env);
    const removed = await linkStore(env, slug).remove(OWNER);
    if (!removed) throw new HttpError(404, "Link was not found.");
    await account(env).removeLink(slug);
    return new Response(null, { status: 204, headers: securityHeaders() });
  }

  return null;
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: securityHeaders() });
  if (request.method === "GET" && path === "/api/health") {
    return json({ ok: true, service: "edge-links", storage: "durable-objects-sqlite" });
  }

  const authResponse = await handleAuthRoutes(request, env, path);
  if (authResponse) return authResponse;

  if (path === "/api/links" && request.method === "GET") return listLinks(request, env);
  if (path === "/api/links" && request.method === "POST") return createLink(request, env);

  const itemResponse = await handleLinkItem(request, env, path);
  if (itemResponse) return itemResponse;
  throw new HttpError(404, "API route was not found.");
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.startsWith("/api/v2/") ? `/api/${url.pathname.slice("/api/v2/".length)}` : url.pathname;
  const dashboardHost = configuredHostname(env.DASHBOARD_HOST);
  const isDashboardHost = dashboardHost !== null && url.hostname.toLowerCase() === dashboardHost;

  if (path.startsWith("/api/")) {
    if (dashboardHost !== null && !isDashboardHost) {
      return withCors(json({ error: "API is available on the dashboard host only." }, { status: 404 }));
    }
    return withCors(await handleApi(request, env, path));
  }
  if (request.method === "GET" && (path === "/" || path === "/index.html")) {
    if (dashboardHost === null || isDashboardHost) return secureResponse(await env.ASSETS.fetch(request));
    const target = configuredRootRedirect(env.ROOT_REDIRECT_URL);
    if (target) {
      return new Response(null, {
        status: 302,
        headers: securityHeaders(new Headers({ Location: target, "Cache-Control": "no-store" })),
      });
    }
    return statusPage(404, "Not found", "This short domain does not serve a homepage.", env.SITE_NAME);
  }

  if (request.method === "GET" && /^\/[^/]+\/?$/u.test(path)) {
    if (isDashboardHost) return statusPage(404, "Not found", "Short links are served from the public domain.", env.SITE_NAME);
    let slug: string;
    try {
      slug = normalizeSlug(decodeURIComponent(path.replace(/^\//u, "").replace(/\/$/u, "")));
    } catch {
      return statusPage(404, "Link not found", "That short link does not exist.", env.SITE_NAME);
    }
    const now = Date.now();
    const result = await linkStore(env, slug).visit(visitMetadata(request, now), now);
    if (result.status === "active") {
      return new Response(null, {
        status: 302,
        headers: securityHeaders(new Headers({ Location: result.target, "Cache-Control": "no-store" })),
      });
    }
    if (result.status === "expired") {
      return statusPage(410, "Link expired", "This short link is no longer active.", env.SITE_NAME);
    }
    return statusPage(404, "Link not found", "That short link does not exist.", env.SITE_NAME);
  }

  if (request.method === "GET") return secureResponse(await env.ASSETS.fetch(request));
  return statusPage(404, "Not found", "The requested page does not exist.", env.SITE_NAME);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        const headers = error.details?.retryAfter ? { "Retry-After": error.details.retryAfter } : undefined;
        const response = json({ error: error.message, details: error.details }, { status: error.status, headers });
        return new URL(request.url).pathname.startsWith("/api/") ? withCors(response) : response;
      }
      console.error(JSON.stringify({
        message: "Unhandled request error",
        method: request.method,
        path: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      const response = json({ error: "Internal server error." }, { status: 500 });
      return new URL(request.url).pathname.startsWith("/api/") ? withCors(response) : response;
    }
  },
} satisfies ExportedHandler<Env>;
