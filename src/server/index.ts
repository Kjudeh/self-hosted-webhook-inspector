import Fastify from "fastify";
import { config } from "./config.js";
import { closeDb, migrate, pool, waitForDb } from "./db.js";
import { sse } from "./sse.js";
import { startCleanupJob } from "./cleanup.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { registerStaticRoutes } from "./routes/static.js";

// Allow capturing bodies larger than the stored cap so we can record the true
// size and flag truncation, instead of rejecting with 413.
const CAPTURE_BODY_LIMIT = Math.max(config.maxBodyBytes * 4, 10 * 1024 * 1024);

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    trustProxy: true, // honour X-Forwarded-* behind Railway's edge
    bodyLimit: CAPTURE_BODY_LIMIT,
  });

  // Capture EVERY body as a raw Buffer regardless of content type. This is the
  // crux of a webhook inspector — nothing may be dropped or mangled.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    "*",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );

  app.get("/health", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "degraded", db: "unavailable" });
    }
  });

  registerStaticRoutes(app);
  registerApiRoutes(app);
  registerCaptureRoutes(app);

  await waitForDb();
  await migrate();
  const stopCleanup = startCleanupJob();

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(`Webhook Inspector listening on :${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down…`);
    stopCleanup();
    sse.closeAll();
    try {
      await app.close();
      await closeDb();
    } catch (err) {
      app.log.error(err);
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
