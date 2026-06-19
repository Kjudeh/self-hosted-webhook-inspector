# Self-Hosted Webhook Inspector — capture, inspect & replay webhooks

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/webhook-inspector)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

**Webhook Inspector is a self-hosted webhook tester, debugger, and replay tool** — an open-source alternative to webhook.site, Hookdeck, and RequestBin that you run on your own infrastructure. Spin up unique capture URLs, watch incoming HTTP requests arrive in real time, inspect every header, query param, and raw body, then replay any captured request to a target of your choice.

One web service + one PostgreSQL database. Deploys to Railway in one click.

> Looking for a **self-hosted webhook.site**, a **self-hosted webhook tester**, a **webhook debugger you can self host**, or a **Railway webhook inspector**? That's exactly what this is.

## Screenshots

<!-- Replace with real screenshots before publishing the template -->
![Webhook Inspector — live request list and detail view](docs/screenshot-main.png)
![Replaying a captured webhook to a target URL](docs/screenshot-replay.png)

## Features

- **Unique capture URLs** — generate as many `/hook/<slug>` endpoints as you need.
- **Capture anything** — any HTTP method, any path suffix, any content type. The **raw body** is preserved byte-for-byte (JSON, form-data, XML, binary, plain text).
- **Live UI via Server-Sent Events** — new requests stream in instantly, no refresh.
- **Full request inspection** — pretty-printed JSON, raw body, header table, and query params in a clean two-pane layout.
- **Replay** — re-send any captured request (method, headers, body) to a target URL and see the response.
- **Configurable responses** — set the status code, body, and content-type each capture URL returns, to simulate real API behavior.
- **Automatic cleanup** — old requests and expired endpoints are pruned on a schedule.
- **Optional access token** — gate the UI and management API; capture URLs stay public.
- **Dark mode, mobile-responsive** UI out of the box.

## Why self-host?

| | Hosted (webhook.site / RequestBin) | **Webhook Inspector (self-hosted)** |
| --- | --- | --- |
| Privacy | Payloads pass through a third party | Data stays in **your** database |
| Expiry | URLs and data often expire | Keep endpoints as long as you want |
| Volume | Rate / request limits on free tiers | Unlimited requests, your hardware |
| Cost | Paid plans for serious use | Free & open source (MIT) |
| Custom domain | Limited | Any domain via `PUBLIC_URL` |

If you're debugging sensitive webhooks (payment events, auth callbacks, customer data), routing them through a public third-party inspector is a real privacy and compliance concern. Self-hosting keeps the payloads on infrastructure you control.

## Comparison vs. webhook.site / Hookdeck / RequestBin

These are excellent hosted tools. Webhook Inspector is aimed at people who'd rather **own the deployment**:

- **vs. webhook.site** — same core "capture & inspect" workflow, but self-hosted with no expiring URLs and unlimited retention you configure yourself.
- **vs. Hookdeck** — Hookdeck is a full delivery/queueing platform; Webhook Inspector is intentionally smaller — a focused inspector + replayer with zero extra moving parts.
- **vs. RequestBin** — similar inspection idea; this adds live SSE updates, configurable responses, and one-click replay, on your own domain.

## Use cases

Debug and develop webhooks from the services you actually use:

- **Stripe** — inspect `payment_intent`, `checkout.session.completed`, and other events; replay them into your local or staging endpoint.
- **GitHub** — examine `push`, `pull_request`, and `workflow_run` webhook payloads and signatures.
- **n8n** — point an n8n HTTP/webhook node at a capture URL while building automations.
- **WhatsApp Business API** — inspect inbound message and status webhooks before wiring up your handler.
- **Shopify** — debug `orders/create`, `app/uninstalled`, and other store webhooks.
- Plus Slack, Twilio, PayPal, Discord, Clerk, Supabase, and any service that sends HTTP webhooks.

## Quickstart

### Deploy on Railway (recommended)

1. Click **Deploy on Railway** above.
2. Railway provisions the app + a PostgreSQL database and wires `DATABASE_URL` automatically.
3. Open the generated URL — you'll get a capture endpoint immediately.
4. (Optional) Set `ACCESS_TOKEN` to password-protect the UI.

### Run locally

```bash
git clone <your-fork-url> webhook-inspector
cd webhook-inspector
cp .env.example .env          # set DATABASE_URL at minimum
npm install
npm run build
npm start                     # serves UI + API on $PORT (default 3000)
```

Or with Docker:

```bash
docker build -t webhook-inspector .
docker run -p 3000:3000 -e DATABASE_URL="postgres://..." webhook-inspector
```

Then open <http://localhost:3000>.

### Try it with curl

```bash
# 1. Create an endpoint
curl -s -X POST http://localhost:3000/api/endpoints | jq

# 2. Send a webhook to the returned capture URL
curl -X POST http://localhost:3000/hook/<slug> \
  -H 'content-type: application/json' \
  -d '{"event":"ping","hello":"world"}'

# 3. List captured requests
curl -s http://localhost:3000/api/endpoints/<slug>/requests | jq
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string. Provided automatically by Railway's Postgres plugin. |
| `PORT` | — | `3000` | HTTP port. Injected by Railway. |
| `RETENTION_HOURS` | — | `168` | Hours to keep captured requests before auto-cleanup (168 = 7 days). |
| `MAX_BODY_BYTES` | — | `1048576` | Max body bytes stored per request (1 MB). Larger bodies are truncated; the true size is still recorded. |
| `ACCESS_TOKEN` | — | _unset_ | If set, gates the UI and management API behind a bearer token / cookie. **Capture URLs stay public.** |
| `PUBLIC_URL` | — | _unset_ | Public base URL used to render capture URLs when behind a custom domain or proxy. |

## API reference

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/endpoints` | Create an endpoint; returns the capture URL. |
| `GET` | `/api/endpoints` | List endpoints. |
| `GET` | `/api/endpoints/:slug` | Get one endpoint. |
| `PATCH` | `/api/endpoints/:slug` | Configure the response (status/body/content-type) or name. |
| `DELETE` | `/api/endpoints/:slug` | Delete an endpoint and its requests. |
| `GET` | `/api/endpoints/:slug/requests` | List captured requests (paginated, newest first). |
| `DELETE` | `/api/endpoints/:slug/requests` | Clear all requests for an endpoint. |
| `GET` | `/api/endpoints/:slug/stream` | Live request stream (SSE). |
| `GET` | `/api/requests/:id` | Full request detail. |
| `DELETE` | `/api/requests/:id` | Delete a single request. |
| `POST` | `/api/requests/:id/replay` | Replay to a target URL (`{ "target": "https://…" }`). |
| `ALL` | `/hook/:slug` and `/hook/:slug/*` | **Public** capture endpoint. |
| `GET` | `/health` | Health check (verifies DB connectivity). |

## Security note

By default the app is **unauthenticated** and intended to run behind Railway's generated URL or a reverse proxy. Set `ACCESS_TOKEN` to require a token for the UI and management API. The capture endpoints under `/hook/*` are always public — that's the point of a webhook receiver.

## Architecture

- **Node.js 20 + TypeScript**, **Fastify** server.
- **PostgreSQL** via `pg` with a thin query layer and a single idempotent SQL migration run on boot.
- **Server-Sent Events** for live updates (no WebSockets, survives proxies).
- **esbuild**-bundled vanilla TypeScript frontend served by the same server — one service, one port.
- Multi-stage **Dockerfile** with a non-root runtime user.

## License

[MIT](./LICENSE)
