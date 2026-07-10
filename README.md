<p align="center">
  <img src="./public/favicon.svg" width="72" height="72" alt="Edge Links">
</p>

<h1 align="center">Edge Links</h1>

<p align="center">A private URL shortener that runs entirely on one Cloudflare Worker.</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/buildwithfur/edge-links"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

Create short links, edit them later, and see basic click analytics. There is one private admin account and no separate database, storage bucket, email service, or server to set up.

## Start here

### Option 1: Deploy with the button

This is the easiest option if you have a GitHub or GitLab account.

1. Select **Deploy to Cloudflare** above.
2. Choose your Cloudflare and Git account.
3. Give the Worker a name and select **Deploy**.
4. Open the new `workers.dev` address Cloudflare gives you.
5. Create your private admin account.

That is enough to start creating links. You can add a custom domain later.

### Option 2: Deploy without GitHub

If you are comfortable using a terminal, download the [latest Edge Links release ZIP](https://github.com/buildwithfur/edge-links/releases/latest/download/edge-links.zip), extract it, and run this from the extracted folder:

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler opens a Cloudflare sign-in page, then deploys directly from your computer. No GitHub account or repository is created.

## What it includes

- One private admin account
- Random or custom short links
- Editable destinations, notes, and expiration dates
- Click counts, daily history, country, browser, and referrer analytics
- A bearer-token API for automations
- Cloudflare Durable Object storage built into the same Worker

## Configuration

These values appear in the Cloudflare deployment form. You can change them later in the Worker's settings.

| Variable | Required | Format | Behavior |
| --- | --- | --- | --- |
| `SITE_NAME` | No | Text | Name shown on status and error pages. Defaults to `Edge Links`. |
| `PUBLIC_ORIGIN` | No | URL origin including `https://` | Base URL shown and returned for short links. When blank, Edge Links uses the origin of the current request. Set this when the dashboard and short links use different hosts. |
| `DASHBOARD_HOST` | No | Hostname without `https://` or a path | Restricts the dashboard and API to this host. When blank, the dashboard, API, and short links share the same host. |
| `ROOT_REDIRECT_URL` | No | Full `http://` or `https://` URL | Redirects the public short-link host's home page when `DASHBOARD_HOST` is set. When blank, that home page returns `404`. It has no effect when `DASHBOARD_HOST` is blank because the home page serves the dashboard. |
| `LINK_LENGTH` | No | Integer from `4` to `16` | Length of randomly generated slugs. Defaults to `6` and does not affect custom slugs. |

### Domain behavior

- Leave `DASHBOARD_HOST` blank to run the dashboard and short links on one host.
- Set `DASHBOARD_HOST` to keep the dashboard and API on a separate host. Set `PUBLIC_ORIGIN` at the same time so generated links use the public short-link host.
- `ROOT_REDIRECT_URL` is optional and only controls the public host's `/` page. It never changes where short links redirect.
- Add every hostname used by Edge Links to the same Worker under **Settings → Domains & Routes**. A hostname cannot remain attached to another Worker or Pages project.
- Changing these variables or adding domains does not move or erase accounts, links, or analytics stored by the Worker.

Cloudflare's deployment form may display a blank-looking value for an optional variable. Edge Links trims whitespace and treats it as unset.

## For developers

Requirements: Node.js 22 or newer and a Cloudflare account.

```bash
npm install
npm run dev
```

```bash
npm run check          # types and tests
npm run deploy:dry-run # validate a deployment without publishing
npm run deploy         # deploy the Worker
```

### API

Generate a token from **API key** in the dashboard. The raw token is shown only when generated.

```bash
curl -X POST https://your-domain.example/api/v2/links \
  -H "Authorization: Bearer lnk_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target":"https://example.com","customurl":"launch"}'
```

## Security

- Only `http://` and `https://` destinations are accepted.
- Login, setup, and link creation are rate-limited.
- Passwords, sessions, and API tokens are stored only as hashes.
- Redirects are not cached, so changed destinations take effect immediately.

## License

Edge Links is maintained by [Buildwithfur](https://github.com/buildwithfur) under the MIT License.
