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

### Start with zero configuration

You can deploy Edge Links without changing any configuration. Cloudflare gives the Worker an address like `https://<project-name>.<account-subdomain>.workers.dev`. That address is both the dashboard and the short-link domain:

- `/` opens the dashboard.
- `/<slug>` redirects through a short link.
- Newly created links use that same `workers.dev` address.

You do not need a custom domain, database, storage bucket, or external service to start.

The values below appear in the Cloudflare deployment form. Every one is optional and can be changed later in the Worker's settings.

| Variable | Default when left alone | Set it when | Format and behavior |
| --- | --- | --- | --- |
| `SITE_NAME` | `Edge Links` | You want a different name on status and error pages. | Text. |
| `PUBLIC_ORIGIN` | The address currently being used | You want every generated link to use one specific domain. | URL origin including `https://`. When blank, Edge Links uses the origin of the current request. |
| `DASHBOARD_HOST` | Dashboard and short links share one host | You want the dashboard and API on their own host. | Hostname without `https://` or a path. When set, generated links should also have `PUBLIC_ORIGIN` set. |
| `ROOT_REDIRECT_URL` | The home page opens the dashboard | You want the public short-link host's `/` page to redirect elsewhere. | Full `http://` or `https://` URL. Only applies when `DASHBOARD_HOST` is set; otherwise `/` remains the dashboard. |
| `LINK_LENGTH` | `6` | You want longer or shorter random slugs. | Integer from `4` to `16`. Does not affect custom slugs. |

### Domain behavior

- Leave `DASHBOARD_HOST` blank to run the dashboard and short links on one host.
- Set `DASHBOARD_HOST` to keep the dashboard and API on a separate host. Set `PUBLIC_ORIGIN` at the same time so generated links use the public short-link host.
- `ROOT_REDIRECT_URL` is optional and only controls the public host's `/` page. It never changes where short links redirect.
- Add every hostname used by Edge Links to the same Worker under **Settings → Domains & Routes**. A hostname cannot remain attached to another Worker or Pages project.
- Changing these variables or adding domains does not move or erase accounts, links, or analytics stored by the Worker.

Cloudflare's deployment form may display a blank-looking value for an optional variable. Edge Links trims whitespace and treats it as unset.

## Recover access

Edge Links does not currently include a password-reset mechanism. If you lose the dashboard password, it cannot be retrieved because passwords are stored only as hashes.

A future optional recovery-token feature will let an owner set a `RECOVERY_TOKEN` as a Cloudflare Worker secret, then use it to choose a new password. It will not require email or any external service. Until that feature is available, keep your admin password in a password manager.

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
