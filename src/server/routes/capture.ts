import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { config } from "../config.js";
import { getEndpointBySlug, insertRequest } from "../queries.js";
import { sse } from "../sse.js";
import type { RequestSummary } from "../../shared/types.js";

const CAPTURE_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

function normalizeHeaders(
  raw: FastifyRequest["headers"],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

export function registerCaptureRoutes(app: FastifyInstance): void {
  // Accepts ANY method, ANY path suffix, ANY content type. Public by design —
  // capture URLs are never gated by ACCESS_TOKEN.
  const handler = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const slug = (req.params as Record<string, string>)["slug"];
    const endpoint = await getEndpointBySlug(slug);
    if (!endpoint) {
      return reply.code(404).send({ error: "unknown endpoint" });
    }

    // body is a Buffer thanks to the wildcard content-type parser.
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const trueSize = buf.length;
    const truncated = trueSize > config.maxBodyBytes;
    const stored = truncated ? buf.subarray(0, config.maxBodyBytes) : buf;
    const bodyRaw = stored.length > 0 ? stored.toString("utf8") : null;
    const contentType =
      (req.headers["content-type"] as string | undefined) ?? null;

    const saved = await insertRequest({
      endpoint_id: endpoint.id,
      method: req.method,
      path: req.url,
      query: req.query as Record<string, unknown>,
      headers: normalizeHeaders(req.headers),
      body_raw: bodyRaw,
      body_size: trueSize,
      truncated,
      content_type: contentType,
      source_ip: req.ip,
    });

    // Push a lightweight summary to any live listeners on this endpoint.
    const summary: RequestSummary = {
      id: saved.id,
      method: saved.method,
      path: saved.path,
      body_size: saved.body_size,
      content_type: saved.content_type,
      received_at: saved.received_at,
    };
    sse.publish(slug, "request", summary);

    return reply
      .code(endpoint.response_status)
      .header("content-type", endpoint.response_content_type)
      .send(endpoint.response_body);
  };

  app.route({ method: CAPTURE_METHODS as never, url: "/hook/:slug", handler });
  app.route({ method: CAPTURE_METHODS as never, url: "/hook/:slug/*", handler });
}
