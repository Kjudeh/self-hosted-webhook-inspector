# Claude Code Build Prompt — Self-Hosted Webhook Inspector

Copy everything below the line into Claude Code as your initial prompt.

---

## Project

Build a **self-hosted webhook inspector and replay tool** — an open-source alternative to webhook.site / Hookdeck. It receives HTTP webhooks at unique URLs, stores the full request (headers, body, query, method, source IP) in PostgreSQL, displays them in a live web UI, and can replay any captured request to a target URL. It must deploy to Railway as a one-click template.

Target user: a developer debugging webhooks from Stripe, GitHub, n8n, WhatsApp Business API, etc. They create an endpoint, point their service at it, watch requests arrive in real time, inspect payloads, and replay them.

## Tech stack (use exactly this — keep it boring and deployable)

- **Runtime:** Node.js 20, TypeScript
- **Framework:** Fastify (lightweight, fast, good for raw-body capture)
- **DB:** PostgreSQL via `pg` (node-postgres). No heavy ORM — use a thin query layer and a single SQL migration file run on boot.
- **Live updates:** Server-Sent Events (SSE), not WebSockets — simpler, survives Railway proxies, no extra deps.
- **Frontend:** Single-page app served by the same Fastify server. Plain TypeScript + lightweight HTML/CSS, OR Preact via CDN/esbuild if cleaner. NO Next.js, no separate frontend deploy. One service, one port.
- **Build:** esbuild for bundling the frontend, `tsc` for the server. Single `npm run build` + `npm start`.
- **Container:** Multi-stage Dockerfile.

Do not add Redis, queues, auth providers, or anything that needs a second service. One web service + one Postgres database is the entire architecture.

## Data model

```
endpoints
  id            uuid primary key default gen_random_uuid()
  slug          text unique not null      -- short, URL-safe, e.g. "a7f3k9"
  name          text                       -- optional user label
  created_at    timestamptz default now()
  expires_at    timestamptz                -- optional auto-cleanup
  response_status   int default 200        -- configurable response returned to caller
  response_body     text default 'OK'
  response_content_type text default 'text/plain'

requests
  id            uuid primary key default gen_random_uuid()
  endpoint_id   uuid references endpoints(id) on delete cascade
  method        text not null
  path          text
  query         jsonb
  headers       jsonb
  body_raw      text                       -- store raw body as text
  body_size     int
  content_type  text
  source_ip     text
  received_at   timestamptz default now()

index on requests(endpoint_id, received_at desc)
```

Run schema as an idempotent migration (`CREATE TABLE IF NOT EXISTS ...`, `CREATE EXTENSION IF NOT EXISTS pgcrypto` for `gen_random_uuid`) on server startup.

## Core features (build all of these)

1. **Create endpoint** — `POST /api/endpoints` generates a new slug, returns the full capture URL. Also a "create" button in the UI.
2. **Capture** — `ALL /hook/:slug` (and `/hook/:slug/*`) accepts ANY method, ANY path suffix, ANY content type. Capture the **raw body** (configure Fastify with a raw-body content-type parser / `addContentTypeParser('*')` so nothing is dropped or mangled). Store the request, then return the endpoint's configured response. Must handle binary and oversized bodies gracefully (cap stored body at e.g. 1MB, record true size, flag truncation).
3. **List requests** — `GET /api/endpoints/:slug/requests` paginated, newest first.
4. **Request detail** — `GET /api/requests/:id` full payload with pretty-printed JSON, header table, query params.
5. **Live stream** — `GET /api/endpoints/:slug/stream` via SSE; new requests push to the UI instantly without refresh.
6. **Replay** — `POST /api/requests/:id/replay` with a target URL in the body; re-sends the captured method/headers/body to that target and returns the response status/body. Strip hop-by-hop headers (Host, Content-Length recomputed).
7. **Configure response** — `PATCH /api/endpoints/:slug` to set custom status/body/content-type returned to callers (lets users simulate API responses).
8. **Delete** — delete a request, or clear all requests for an endpoint.
9. **Auto-cleanup** — a lightweight interval job deletes requests older than a configurable retention window (env `RETENTION_HOURS`, default 168 = 7 days) and expired endpoints.

## UI requirements

- Clean two-pane layout: left = list of recent requests (method badge, path, timestamp, size); right = detail of selected request.
- Top bar: current endpoint's capture URL with a copy button; "New endpoint" button; "Clear all" button.
- Live indicator showing SSE connection status; new requests animate in at the top.
- Detail pane tabs: **Pretty** (formatted JSON/body), **Raw**, **Headers**, **Query**.
- Replay button in detail pane → modal to enter target URL → shows replay result.
- Mobile-responsive, dark mode by default. Keep it genuinely clean — this is the screenshot people will see in the marketplace, so it sells the template.
- No login. (Note in README that it's unauthenticated by default and meant to run behind Railway's URL or a reverse proxy; optionally support a single `ACCESS_TOKEN` env that, if set, gates the UI and API with a simple bearer/cookie check. Capture endpoints `/hook/*` stay public — that's the point.)

## Configuration (env vars)

- `DATABASE_URL` — provided by Railway Postgres plugin.
- `PORT` — provided by Railway.
- `RETENTION_HOURS` — default 168.
- `MAX_BODY_BYTES` — default 1048576 (1MB) stored cap.
- `ACCESS_TOKEN` — optional; if set, protects UI/API (not capture URLs).
- `PUBLIC_URL` — optional; used to render correct capture URLs if behind a custom domain.

## Railway template files (important — this is what makes it deployable)

Generate:
- `Dockerfile` (multi-stage: build → slim runtime, non-root user, expose `$PORT`).
- `railway.json` or `railway.toml` with a healthcheck path (`GET /health` returning 200) and restart policy.
- `.env.example` documenting every variable.
- A `README.md` written for **both humans and SEO** (see below).

## README / SEO (write this carefully — it's half the value)

The README must rank for searches like "self-hosted webhook.site", "self-hosted webhook tester", "webhook debugger self hosted", "railway webhook inspector".

Include:
- H1 with a clear one-line description containing "self-hosted webhook inspector / tester / debugger".
- A "Deploy on Railway" button placeholder (`[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/...)`).
- A short feature list with the keywords naturally included.
- A "Why self-host?" section (privacy, no expiring URLs, unlimited requests, free).
- Comparison framing vs webhook.site / Hookdeck / RequestBin (factual, not disparaging).
- Quickstart, env var table, and a "Use cases" section naming Stripe, GitHub, n8n, WhatsApp Business API, Shopify webhooks explicitly (these pull long-tail search traffic).
- Screenshots section with placeholders.
- License: MIT.

## Project structure

```
/src
  /server   (Fastify app, routes, db, migrations, sse, cleanup job)
  /client   (frontend TS, index.html, styles)
/migrations/001_init.sql
Dockerfile
railway.toml
.env.example
README.md
package.json
tsconfig.json
```

## Quality bar

- TypeScript strict mode on.
- Graceful shutdown (close DB pool, end SSE connections on SIGTERM).
- Parameterized SQL everywhere — no string interpolation into queries.
- Handle the DB being briefly unavailable on cold start (retry connection a few times before exit).
- A `GET /health` endpoint that checks DB connectivity.
- Include a short `CONTRIBUTING`-free, dependency-light setup so it builds clean on Railway's Nixpacks/Docker.

## Build order

1. Scaffold project, package.json, tsconfig, Dockerfile, railway.toml.
2. DB layer + migration + health check.
3. Capture route with raw-body parser (the trickiest part — get this right first, test with curl posting JSON, form-data, and raw text).
4. Endpoints + requests CRUD APIs.
5. SSE live stream.
6. Replay.
7. Frontend.
8. Cleanup job.
9. README + SEO.

Start by laying out the full file tree and the package.json, then implement in the order above. After each major piece, give me a `curl` command I can run locally to verify it before moving on.
