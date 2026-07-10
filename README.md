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

## Buildwithfur setup

Use these exact values when deploying Edge Links for Buildwithfur:

| Field in the deploy form | Value |
| --- | --- |
| `SITE_NAME` | `Buildwithfur Links` |
| `PUBLIC_ORIGIN` | `https://bwf.sh` |
| `DASHBOARD_HOST` | `edge-links.bwf.sh` |
| `ROOT_REDIRECT_URL` | `https://furqaan.net` |
| `LINK_LENGTH` | `6` |

After deployment:

1. Open **Workers & Pages** in Cloudflare and select the Edge Links Worker.
2. Select **Settings → Domains & Routes → Add Custom Domain**.
3. Add `bwf.sh`.
4. Add `edge-links.bwf.sh`.
5. Open `https://edge-links.bwf.sh` and create the admin account.
6. Create the custom link `furqaan` with destination `https://furqaan.net`.

You will then have:

```text
bwf.sh                 → https://furqaan.net
bwf.sh/furqaan         → https://furqaan.net
edge-links.bwf.sh      → private Edge Links dashboard
```

Do not add `bwf.sh` to the `furqaan.net` deployment. Both `bwf.sh` and `edge-links.bwf.sh` belong to Edge Links.

## What it includes

- One private admin account
- Random or custom short links
- Editable destinations, notes, and expiration dates
- Click counts, daily history, country, browser, and referrer analytics
- A bearer-token API for automations
- Cloudflare Durable Object storage built into the same Worker

## Advanced configuration

Most people do not need to edit configuration files. These settings are available if you do:

| Setting | What it does |
| --- | --- |
| `SITE_NAME` | Name shown on error pages |
| `PUBLIC_ORIGIN` | The domain used when new short links are created |
| `DASHBOARD_HOST` | A separate hostname for the private dashboard |
| `ROOT_REDIRECT_URL` | Where the public domain's home page redirects |
| `LINK_LENGTH` | Characters in randomly generated links; 4–16, default 6 |

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
