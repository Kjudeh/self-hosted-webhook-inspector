function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return Math.floor(n);
}

export const config = {
  port: intEnv("PORT", 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  retentionHours: intEnv("RETENTION_HOURS", 168),
  maxBodyBytes: intEnv("MAX_BODY_BYTES", 1_048_576),
  accessToken: process.env.ACCESS_TOKEN?.trim() || undefined,
  publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, "") || undefined,
} as const;

if (!config.databaseUrl) {
  // Fail fast with a clear message rather than an opaque pg error later.
  // eslint-disable-next-line no-console
  console.error("FATAL: DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
