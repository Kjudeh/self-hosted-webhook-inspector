import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

const COOKIE_NAME = "wi_token";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function presentedToken(req: FastifyRequest): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const cookies = parseCookies(req.headers["cookie"]);
  return cookies[COOKIE_NAME];
}

/**
 * Guards UI + management API when ACCESS_TOKEN is configured.
 * Capture routes (/hook/*) must NOT use this — they stay public by design.
 * Returns true if the request may proceed.
 */
export function checkAccess(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.accessToken) return true;

  const token = presentedToken(req);
  if (token && safeEqual(token, config.accessToken)) return true;

  reply.code(401).send({ error: "unauthorized" });
  return false;
}

export function setAuthCookie(reply: FastifyReply, token: string): void {
  reply.header(
    "set-cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
  );
}

export { COOKIE_NAME, safeEqual };
