import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import { config } from "../config.js";
import { checkAccess, safeEqual, setAuthCookie } from "../auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/server/routes/static.js → dist/client
const CLIENT_DIR = resolve(__dirname, "../../client");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function sendFile(
  reply: FastifyReply,
  file: string,
): Promise<FastifyReply> {
  const ext = file.slice(file.lastIndexOf("."));
  const path = resolve(CLIENT_DIR, file);
  // Guard against path traversal — resolved path must stay within CLIENT_DIR.
  if (!path.startsWith(CLIENT_DIR)) {
    return reply.code(403).send("forbidden");
  }
  try {
    const content = await readFile(path);
    return reply
      .header("content-type", MIME[ext] ?? "application/octet-stream")
      .send(content);
  } catch {
    return reply.code(404).send("not found");
  }
}

const LOGIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · Webhook Inspector</title>
<style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif}
  form{background:#161b22;border:1px solid #30363d;padding:2rem;border-radius:12px;width:min(90vw,320px)}
  h1{font-size:1.1rem;margin:0 0 1rem}
  input{width:100%;box-sizing:border-box;padding:.6rem;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;margin-bottom:.8rem}
  button{width:100%;padding:.6rem;border:0;border-radius:8px;background:#2f81f7;color:#fff;font-weight:600;cursor:pointer}
  .err{color:#f85149;font-size:.85rem;min-height:1.2em}
</style></head><body>
<form id="f"><h1>🪝 Webhook Inspector</h1>
<input id="t" type="password" placeholder="Access token" autofocus>
<div class="err" id="e"></div>
<button type="submit">Sign in</button></form>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const token = document.getElementById('t').value;
  const r = await fetch('/api/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
  if (r.ok) location.href = '/';
  else document.getElementById('e').textContent = 'Invalid token';
});
</script></body></html>`;

export function registerStaticRoutes(app: FastifyInstance): void {
  // Login endpoint (exempt from the /api gate via check in api.ts hook).
  app.post("/api/login", async (req, reply) => {
    if (!config.accessToken) return reply.send({ ok: true });
    let token = "";
    if (Buffer.isBuffer(req.body)) {
      try {
        token = (JSON.parse(req.body.toString("utf8")) as { token?: string })
          .token ?? "";
      } catch {
        token = "";
      }
    }
    if (token && safeEqual(token, config.accessToken)) {
      setAuthCookie(reply, token);
      return reply.send({ ok: true });
    }
    return reply.code(401).send({ error: "invalid token" });
  });

  // SPA shell.
  app.get("/", async (req, reply) => {
    if (config.accessToken) {
      // Probe auth without emitting a 401 body; show login page if missing.
      const authed = checkAuthSilently(req);
      if (!authed) {
        return reply.type("text/html").send(LOGIN_HTML);
      }
    }
    return sendFile(reply, "index.html");
  });

  // Bundled assets (no secrets — safe to serve unauthenticated).
  app.get("/app.js", (_req, reply) => sendFile(reply, "app.js"));
  app.get("/app.js.map", (_req, reply) => sendFile(reply, "app.js.map"));
  app.get("/styles.css", (_req, reply) => sendFile(reply, "styles.css"));

  // Helper kept local so we don't send a 401 from checkAccess on the shell.
  function checkAuthSilently(req: Parameters<typeof checkAccess>[0]): boolean {
    const fakeReply = {
      code() {
        return this;
      },
      send() {
        return this;
      },
    } as unknown as FastifyReply;
    return checkAccess(req, fakeReply);
  }
}
