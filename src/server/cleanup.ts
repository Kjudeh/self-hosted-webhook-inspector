import { config } from "./config.js";
import { deleteExpiredEndpoints, deleteOldRequests } from "./queries.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

export function startCleanupJob(): () => void {
  async function run(): Promise<void> {
    try {
      const requests = await deleteOldRequests(config.retentionHours);
      const endpoints = await deleteExpiredEndpoints();
      if (requests > 0 || endpoints > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `Cleanup: removed ${requests} old request(s), ${endpoints} expired endpoint(s).`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`Cleanup failed: ${msg}`);
    }
  }

  // Run shortly after boot, then hourly.
  const initial = setTimeout(run, 10_000);
  initial.unref?.();
  const interval = setInterval(run, ONE_HOUR_MS);
  interval.unref?.();

  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
