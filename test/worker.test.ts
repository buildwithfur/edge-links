import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const origin = "https://short.example";

async function jsonRequest(path: string, method: string, body?: unknown, cookie?: string, bearer?: string): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" });
  if (cookie) headers.set("Cookie", cookie);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  return SELF.fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
}

describe("link shortener Worker", () => {
  it("runs the complete owner workflow with redirects, analytics, and API access", async () => {
    const health = await SELF.fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true, storage: "durable-objects-sqlite" });

    const unauthorized = await SELF.fetch(`${origin}/api/links`);
    expect(unauthorized.status).toBe(401);

    const initialStatus = await SELF.fetch(`${origin}/api/auth/status`);
    await expect(initialStatus.json()).resolves.toMatchObject({ needsSetup: true, authenticated: false });

    const setup = await jsonRequest("/api/auth/setup", "POST", {
      email: "admin@example.com",
      password: "a-long-test-password",
    });
    expect(setup.status).toBe(201);
    const cookie = setup.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toMatch(/^shortener_session=/u);

    const create = await jsonRequest(
      "/api/links",
      "POST",
      { target: "https://example.com/launch", slug: "launch", description: "Launch campaign" },
      cookie,
    );
    expect(create.status).toBe(201);
    const created = await create.json<{ link: string; slug: string; visitCount: number }>();
    expect(created).toMatchObject({ link: "https://short.example/launch", slug: "launch", visitCount: 0 });

    const duplicate = await jsonRequest(
      "/api/links",
      "POST",
      { target: "https://example.com", customurl: "launch" },
      cookie,
    );
    expect(duplicate.status).toBe(409);

    const redirect = await SELF.fetch(`${origin}/launch`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.com/launch");

    const stats = await SELF.fetch(`${origin}/api/links/launch/stats`, { headers: { Cookie: cookie ?? "" } });
    expect(stats.status).toBe(200);
    await expect(stats.json()).resolves.toMatchObject({ total: 1, daily: [{ count: 1 }] });

    const list = await SELF.fetch(`${origin}/api/links`, { headers: { Cookie: cookie ?? "" } });
    const listed = await list.json<{ total: number; data: Array<{ slug: string; visitCount: number }> }>();
    expect(listed.total).toBe(1);
    expect(listed.data[0]).toMatchObject({ slug: "launch", visitCount: 1 });

    const update = await jsonRequest(
      "/api/links/launch",
      "PATCH",
      { target: "https://example.com/new", description: "Updated" },
      cookie,
    );
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ target: "https://example.com/new", description: "Updated" });

    const apiKeyResponse = await jsonRequest("/api/auth/apikey", "POST", {}, cookie);
    expect(apiKeyResponse.status).toBe(200);
    const { apiKey } = await apiKeyResponse.json<{ apiKey: string }>();
    expect(apiKey).toMatch(/^lnk_/u);

    const apiCreate = await jsonRequest(
      "/api/v2/links",
      "POST",
      { target: "https://example.com/api", customurl: "from-api" },
      undefined,
      apiKey,
    );
    expect(apiCreate.status).toBe(201);
    await expect(apiCreate.json()).resolves.toMatchObject({ address: "from-api", link: "https://short.example/from-api" });

    const remove = await jsonRequest("/api/links/launch", "DELETE", undefined, cookie);
    expect(remove.status).toBe(204);
    const missing = await SELF.fetch(`${origin}/launch`, { redirect: "manual" });
    expect(missing.status).toBe(404);
  }, 20_000);
});
