// Types shared between the Fastify server and the browser client.

export interface Endpoint {
  id: string;
  slug: string;
  name: string | null;
  created_at: string;
  expires_at: string | null;
  response_status: number;
  response_body: string;
  response_content_type: string;
}

export interface CapturedRequest {
  id: string;
  endpoint_id: string;
  method: string;
  path: string | null;
  query: Record<string, unknown> | null;
  headers: Record<string, string> | null;
  body_raw: string | null;
  body_size: number | null;
  truncated: boolean;
  content_type: string | null;
  source_ip: string | null;
  received_at: string;
}

/** Lightweight row used for the request list (no body). */
export interface RequestSummary {
  id: string;
  method: string;
  path: string | null;
  body_size: number | null;
  content_type: string | null;
  received_at: string;
}

export interface ReplayResult {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}
