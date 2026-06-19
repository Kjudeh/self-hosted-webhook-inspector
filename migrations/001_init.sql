-- Webhook Inspector schema. Idempotent: safe to run on every boot.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS endpoints (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text UNIQUE NOT NULL,
  name                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz,
  response_status       int  NOT NULL DEFAULT 200,
  response_body         text NOT NULL DEFAULT 'OK',
  response_content_type text NOT NULL DEFAULT 'text/plain'
);

CREATE TABLE IF NOT EXISTS requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id   uuid NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  method        text NOT NULL,
  path          text,
  query         jsonb,
  headers       jsonb,
  body_raw      text,
  body_size     int,
  truncated     boolean NOT NULL DEFAULT false,
  content_type  text,
  source_ip     text,
  received_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requests_endpoint_received
  ON requests (endpoint_id, received_at DESC);
