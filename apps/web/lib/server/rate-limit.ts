import { ServiceError } from "@procura/shared";

/**
 * A small in-memory sliding-window limiter for paid model calls. It protects the SERV bill from a
 * runaway client; it is per server instance, so a multi-instance deployment should move it to Redis.
 */
const hits = new Map<string, number[]>();

export function limitPerHour(key: string, max: number, now = Date.now()): void {
  const windowStart = now - 3_600_000;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= max) {
    throw new ServiceError("RATE_LIMITED", "You have used the agent a lot in the last hour. Try again later.", 429);
  }
  recent.push(now);
  hits.set(key, recent);
}
