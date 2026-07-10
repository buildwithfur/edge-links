<p align="center">
  <img src="./public/favicon.svg" width="72" height="72" alt="Edge Links">
</p>

<h1 align="center">Edge Links</h1>

<p align="center">A private, one-Worker URL shortener built by Buildwithfur.</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/buildwithfur/edge-links"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

The dashboard, redirect service, API, authentication, link records, and click analytics deploy together as one Cloudflare Worker. Durable Objects provide the built-in SQLite storage, so there is no external database, R2 bucket, KV namespace, Redis instance, mail provider, or separate frontend to configure.

The public template is domain-neutral: its interface reads the deployed hostname at runtime and the default deploy works on a new `workers.dev` address.

## What you get

- First-run setup for one private admin account
- Random or custom short links
- Editable destination, internal note, and optional expiration
- Per-link click counts, daily history, country, browser, and referrer analytics
- Search, pagination, copy, edit, stats, and delete controls
- A revocable bearer token and `POST /api/v2/links` automation endpoint
- Static UI and API shipped with the Worker in one deployment
- SQLite-backed Durable Objects provisioned automatically by Wrangler
- No runtime npm dependencies

## Deploy without GitHub

You only need a Cloudflare account. Download the [Edge Links source ZIP](https://github.com/buildwithfur/edge-links/archive/refs/heads/main.zip), extract it, then run the following from the extracted folder:

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler opens a Cloudflare sign-in page, then deploys directly from your computer. No GitHub account, Git repository, or Git integration is created.

## Deploy with GitHub or GitLab

1. Select **Deploy to Cloudflare** above.
2. Choose a Cloudflare account and accept the detected Worker settings.
3. Open the assigned `workers.dev` URL and create the single admin account.
4. Optionally attach your short domain in **Workers & Pages → your Worker → Settings → Domains & Routes → Add → Custom Domain**.

This Git-based option creates a copy of the repository in your GitHub or GitLab account and enables automatic deployments for future pushes. The default configuration does not claim a domain, which lets anyone deploy the repository. To manage a custom domain as code, add a route to `wrangler.jsonc`:

```jsonc
"routes": [
  { "pattern": "go.example.com", "custom_domain": true }
]
```

Set `PUBLIC_ORIGIN` to the custom origin if links should always use it even when you open the dashboard through `workers.dev`:

```jsonc
"PUBLIC_ORIGIN": "https://go.example.com"
```

### Public short domain with a separate dashboard

Attach both hostnames to the same Worker, then use these deployment values:

| Setting | Value |
| --- | --- |
| `PUBLIC_ORIGIN` | `https://bwf.sh` |
| `DASHBOARD_HOST` | `edge-links.bwf.sh` |
| `ROOT_REDIRECT_URL` | `https://furqaan.net` |

With that setup, `edge-links.bwf.sh` serves the private dashboard, `bwf.sh` redirects to `furqaan.net`, and links such as `bwf.sh/furqaan` continue to be resolved by Edge Links. Do not attach `bwf.sh` to the `furqaan.net` deployment; both `bwf.sh` and `edge-links.bwf.sh` belong to the Edge Links Worker.

To configure this exact setup:

1. Deploy Edge Links, entering the values in the table above.
2. In **Workers & Pages → Edge Links → Settings → Domains & Routes**, add both `bwf.sh` and `edge-links.bwf.sh` as Custom Domains.
3. Visit `https://edge-links.bwf.sh` to create the sole admin account.
4. Create the custom alias `furqaan` with destination `https://furqaan.net`.

The result is:

```text
bwf.sh                 → https://furqaan.net
bwf.sh/furqaan         → https://furqaan.net
edge-links.bwf.sh      → private Edge Links dashboard
```

## Local development

Requirements: Node.js 22 or newer and a Cloudflare account for deployment.

```bash
npm install
npm run dev
```

Wrangler runs the Worker, static assets, and Durable Object storage locally. Local data is kept under `.wrangler/` and ignored by Git.

```bash
npm run types          # regenerate binding/runtime types
npm run typecheck      # strict TypeScript validation
npm test               # integration tests in the Workers runtime
npm run check          # types + typecheck + tests
npm run deploy:dry-run # validate the production bundle
npm run deploy         # deploy the Worker and DO migrations
```

## Configuration

Non-secret settings live in `wrangler.jsonc`:

| Setting | Default | Purpose |
| --- | --- | --- |
| `SITE_NAME` | `Edge Links` | Name used by generated status and error pages |
| `PUBLIC_ORIGIN` | empty | Optional canonical origin; otherwise the request origin is used |
| `DASHBOARD_HOST` | empty | Optional dashboard hostname, for example `edge-links.bwf.sh` |
| `ROOT_REDIRECT_URL` | empty | Optional destination for the public domain's `/` path when `DASHBOARD_HOST` is set |
| `LINK_LENGTH` | `6` | Length of generated slugs, clamped to 4–16 |

There are no required secrets. The first-run password is uniquely salted and hashed with PBKDF2-HMAC-SHA256 at Cloudflare Workers' supported maximum of 100,000 iterations. Login and setup are additionally protected by per-IP Durable Object rate limits. Session and API tokens are cryptographically random; only their SHA-256 hashes are stored.

## API

Generate a token from **API key** in the dashboard. The raw token is shown only when generated.

Create a generated link:

```bash
curl -X POST https://go.example.com/api/v2/links \
  -H "Authorization: Bearer lnk_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target":"https://example.com"}'
```

Create a custom link:

```bash
curl -X POST https://go.example.com/api/v2/links \
  -H "Authorization: Bearer lnk_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target":"https://example.com/launch",
    "customurl":"launch",
    "description":"Launch campaign",
    "expire_in":"2027-01-01T00:00:00Z"
  }'
```

Other dashboard endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health and storage check |
| `GET` | `/api/links` | Search and list links |
| `POST` | `/api/links` | Create a link |
| `PATCH` | `/api/links/{slug}` | Update destination, note, or expiration |
| `DELETE` | `/api/links/{slug}` | Delete a link and its analytics |
| `GET` | `/api/links/{slug}/stats` | Read link analytics |

## Security notes

- Only absolute `http://` and `https://` destinations are accepted.
- Custom slugs are normalized to lowercase and restricted to letters, numbers, `_`, and `-`.
- Login, setup, and link creation are rate-limited with per-IP Durable Objects.
- Authentication cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` on HTTPS.
- API and session tokens are never stored in plaintext.
- Responses include CSP, clickjacking, MIME-sniffing, referrer, and permissions-policy headers.
- Redirects use `302` and `Cache-Control: no-store`, so edited destinations take effect immediately.

## Attribution

The Edge Links implementation and interface are maintained by [Buildwithfur](https://github.com/buildwithfur) under the MIT License.
