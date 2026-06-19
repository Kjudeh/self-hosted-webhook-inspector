import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { checkAccess } from "../auth.js";
import { generateSlug } from "../slug.js";
import { replayRequest } from "../replay.js";
import { sse } from "../sse.js";
import {
  clearRequests,
  createEndpoint,
  deleteEndpoint,
  deleteRequest,
  getEndpointBySlug,
  getRequest,
  listEndpoints,
  listRequests,
  updateEndpointResponse,
} from "../queries.js";

function readJson<T>(req: FastifyRequest): T {
  if (req.body == null) return {} as T;
  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString("utf8").trim();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }
  return req.body as T;
}

function captureUrl(req: FastifyRequest, slug: string): string {
  if (config.publicUrl) return `${config.publicUrl}/hook/${slug}`;
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host = req.headers["host"] ?? `localhost:${config.port}`;
  return `${proto}://${host}/hook/${slug}`;
}

export function registerApiRoutes(app: FastifyInstance): void {
  // Gate every /api/* route when ACCESS_TOKEN is configured.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url.startsWith("/api/login")) return; // login must stay reachable
    if (!checkAccess(req, reply)) return reply; // 401 already sent
  });

  // ---- Endpoints ----

  app.post("/api/endpoints", async (req, reply) => {
    const body = readJson<{ name?: string; expiresInHours?: number }>(req);
    let expiresAt: string | null = null;
    if (typeof body.expiresInHours === "number" && body.expiresInHours > 0) {
      expiresAt = new Date(
        Date.now() + body.expiresInHours * 3_600_000,
      ).toISOString();
    }

    // Retry once on the astronomically unlikely slug collision.
    let endpoint = null;
    for (let i = 0; i < 3 && !endpoint; i++) {
      try {
        endpoint = await createEndpoint(
          generateSlug(),
          body.name?.trim() || null,
          expiresAt,
        );
      } catch (err) {
        if (i === 2) throw err;
      }
    }

    return reply.code(201).send({
      ...endpoint,
      capture_url: captureUrl(req, endpoint!.slug),
    });
  });

  app.get("/api/endpoints", async (req) => {
    const endpoints = await listEndpoints();
    return endpoints.map((e) => ({
      ...e,
      capture_url: captureUrl(req, e.slug),
    }));
  });

  app.get("/api/endpoints/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const endpoint = await getEndpointBySlug(slug);
    if (!endpoint) return reply.code(404).send({ error: "not found" });
    return { ...endpoint, capture_url: captureUrl(req, endpoint.slug) };
  });

  app.patch("/api/endpoints/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const body = readJson<{
      name?: string | null;
      response_status?: number;
      response_body?: string;
      response_content_type?: string;
    }>(req);

    if (
      body.response_status !== undefined &&
      (!Number.isInteger(body.response_status) ||
        body.response_status < 100 ||
        body.response_status > 599)
    ) {
      return reply.code(400).send({ error: "response_status must be 100–599" });
    }

    const updated = await updateEndpointResponse(slug, body);
    if (!updated) return reply.code(404).send({ error: "not found" });
    return { ...updated, capture_url: captureUrl(req, updated.slug) };
  });

  app.delete("/api/endpoints/:slug", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const ok = await deleteEndpoint(slug);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });

  // ---- Requests ----

  app.get("/api/endpoints/:slug/requests", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const q = req.query as { limit?: string; before?: string };
    const endpoint = await getEndpointBySlug(slug);
    if (!endpoint) return reply.code(404).send({ error: "not found" });

    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const before = q.before ?? null;
    const requests = await listRequests(endpoint.id, limit, before);
    return { requests, limit };
  });

  app.delete("/api/endpoints/:slug/requests", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const endpoint = await getEndpointBySlug(slug);
    if (!endpoint) return reply.code(404).send({ error: "not found" });
    const count = await clearRequests(endpoint.id);
    return { cleared: count };
  });

  app.get("/api/requests/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const request = await getRequest(id);
    if (!request) return reply.code(404).send({ error: "not found" });
    return request;
  });

  app.delete("/api/requests/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await deleteRequest(id);
    if (!ok) return reply.code(404).send({ error: "not found" });
    return reply.code(204).send();
  });

  app.post("/api/requests/:id/replay", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = readJson<{ target?: string; url?: string }>(req);
    const target = (body.target ?? body.url ?? "").trim();
    if (!target) {
      return reply.code(400).send({ error: "target URL is required" });
    }

    const request = await getRequest(id);
    if (!request) return reply.code(404).send({ error: "not found" });

    try {
      const result = await replayRequest(request, target);
      return result;
    } catch (err) {
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Live stream (SSE) ----

  app.get("/api/endpoints/:slug/stream", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const endpoint = await getEndpointBySlug(slug);
    if (!endpoint) return reply.code(404).send({ error: "not found" });

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ slug })}\n\n`);

    const unsubscribe = sse.subscribe(slug, reply);
    req.raw.on("close", () => {
      unsubscribe();
    });

    // Returning the reply tells Fastify we're managing the response stream.
    return reply;
  });
}
