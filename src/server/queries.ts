import { query } from "./db.js";
import type {
  CapturedRequest,
  Endpoint,
  RequestSummary,
} from "../shared/types.js";

// ---- Endpoints ----

export async function createEndpoint(
  slug: string,
  name: string | null,
  expiresAt: string | null,
): Promise<Endpoint> {
  const { rows } = await query<Endpoint>(
    `INSERT INTO endpoints (slug, name, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [slug, name, expiresAt],
  );
  return rows[0];
}

export async function getEndpointBySlug(
  slug: string,
): Promise<Endpoint | null> {
  const { rows } = await query<Endpoint>(
    `SELECT * FROM endpoints WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function listEndpoints(): Promise<Endpoint[]> {
  const { rows } = await query<Endpoint>(
    `SELECT * FROM endpoints ORDER BY created_at DESC`,
  );
  return rows;
}

export async function updateEndpointResponse(
  slug: string,
  patch: {
    name?: string | null;
    response_status?: number;
    response_body?: string;
    response_content_type?: string;
  },
): Promise<Endpoint | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  for (const key of [
    "name",
    "response_status",
    "response_body",
    "response_content_type",
  ] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      params.push(patch[key]);
    }
  }

  if (sets.length === 0) return getEndpointBySlug(slug);

  params.push(slug);
  const { rows } = await query<Endpoint>(
    `UPDATE endpoints SET ${sets.join(", ")} WHERE slug = $${i} RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteEndpoint(slug: string): Promise<boolean> {
  const { rowCount } = await query(
    `DELETE FROM endpoints WHERE slug = $1`,
    [slug],
  );
  return (rowCount ?? 0) > 0;
}

// ---- Requests ----

export async function insertRequest(input: {
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
}): Promise<CapturedRequest> {
  const { rows } = await query<CapturedRequest>(
    `INSERT INTO requests
       (endpoint_id, method, path, query, headers, body_raw, body_size,
        truncated, content_type, source_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      input.endpoint_id,
      input.method,
      input.path,
      input.query ? JSON.stringify(input.query) : null,
      input.headers ? JSON.stringify(input.headers) : null,
      input.body_raw,
      input.body_size,
      input.truncated,
      input.content_type,
      input.source_ip,
    ],
  );
  return rows[0];
}

export async function listRequests(
  endpointId: string,
  limit: number,
  before: string | null,
): Promise<RequestSummary[]> {
  const params: unknown[] = [endpointId];
  let where = `endpoint_id = $1`;
  if (before) {
    params.push(before);
    where += ` AND received_at < $${params.length}`;
  }
  params.push(limit);
  const { rows } = await query<RequestSummary>(
    `SELECT id, method, path, body_size, content_type, received_at
     FROM requests
     WHERE ${where}
     ORDER BY received_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function getRequest(id: string): Promise<CapturedRequest | null> {
  const { rows } = await query<CapturedRequest>(
    `SELECT * FROM requests WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function deleteRequest(id: string): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM requests WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function clearRequests(endpointId: string): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM requests WHERE endpoint_id = $1`,
    [endpointId],
  );
  return rowCount ?? 0;
}

// ---- Cleanup ----

export async function deleteOldRequests(retentionHours: number): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM requests
     WHERE received_at < now() - ($1 || ' hours')::interval`,
    [String(retentionHours)],
  );
  return rowCount ?? 0;
}

export async function deleteExpiredEndpoints(): Promise<number> {
  const { rowCount } = await query(
    `DELETE FROM endpoints
     WHERE expires_at IS NOT NULL AND expires_at < now()`,
  );
  return rowCount ?? 0;
}
