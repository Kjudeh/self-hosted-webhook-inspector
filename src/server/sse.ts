import type { FastifyReply } from "fastify";

interface Client {
  id: number;
  reply: FastifyReply;
}

/**
 * Tracks SSE subscribers per endpoint slug and broadcasts events to them.
 * Kept deliberately simple: no external broker, just in-process fan-out.
 */
class SseHub {
  private clients = new Map<string, Set<Client>>();
  private nextId = 1;
  private heartbeat: NodeJS.Timeout;

  constructor() {
    // Comment pings keep proxies (and Railway's edge) from closing idle streams.
    this.heartbeat = setInterval(() => this.pingAll(), 25_000);
    this.heartbeat.unref?.();
  }

  subscribe(slug: string, reply: FastifyReply): () => void {
    const client: Client = { id: this.nextId++, reply };
    let set = this.clients.get(slug);
    if (!set) {
      set = new Set();
      this.clients.set(slug, set);
    }
    set.add(client);

    return () => {
      const current = this.clients.get(slug);
      if (!current) return;
      current.delete(client);
      if (current.size === 0) this.clients.delete(slug);
    };
  }

  publish(slug: string, event: string, data: unknown): void {
    const set = this.clients.get(slug);
    if (!set || set.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of set) {
      try {
        client.reply.raw.write(payload);
      } catch {
        // Best-effort; broken connections get cleaned up by the close handler.
      }
    }
  }

  private pingAll(): void {
    for (const set of this.clients.values()) {
      for (const client of set) {
        try {
          client.reply.raw.write(": ping\n\n");
        } catch {
          /* ignore */
        }
      }
    }
  }

  closeAll(): void {
    clearInterval(this.heartbeat);
    for (const set of this.clients.values()) {
      for (const client of set) {
        try {
          client.reply.raw.end();
        } catch {
          /* ignore */
        }
      }
    }
    this.clients.clear();
  }
}

export const sse = new SseHub();
