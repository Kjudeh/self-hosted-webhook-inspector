import type { CapturedRequest, ReplayResult } from "../shared/types.js";

// Hop-by-hop and connection-specific headers that must not be forwarded.
const STRIP_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "accept-encoding",
]);

const REPLAY_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_CHARS = 256 * 1024;

export async function replayRequest(
  captured: CapturedRequest,
  targetUrl: string,
): Promise<ReplayResult> {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new Error("Invalid target URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Target URL must use http or https");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(captured.headers ?? {})) {
    if (!STRIP_HEADERS.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  const method = captured.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPLAY_TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? captured.body_raw ?? undefined : undefined,
      signal: controller.signal,
      redirect: "manual",
    });

    const text = await res.text();
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: respHeaders,
      body:
        text.length > MAX_RESPONSE_CHARS
          ? text.slice(0, MAX_RESPONSE_CHARS) + "\n…[truncated]"
          : text,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Replay timed out after ${REPLAY_TIMEOUT_MS}ms`);
    }
    throw new Error(
      `Replay failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
