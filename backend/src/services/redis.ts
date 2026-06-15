import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

// Gracefully skip Redis if not configured (local dev without Upstash)
function createRedisClient(name: string): Redis | null {
  if (!REDIS_URL || REDIS_URL.includes("YOUR_PASSWORD") || REDIS_URL.includes("********")) {
    console.warn(`⚠️  Redis not configured — ${name} disabled. Set REDIS_URL in .env`);
    return null;
  }
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
    tls: REDIS_URL.startsWith("rediss://") ? {} : undefined,
  });
  client.on("connect", () => console.log(`✅ Redis ${name} connected`));
  client.on("error", (err) => console.error(`❌ Redis ${name} error:`, err.message));
  return client;
}

// Two separate clients: one for publishing, one for subscribing
// (ioredis subscriber client can ONLY subscribe — can't publish on the same conn)
export const publisher = createRedisClient("publisher");
export const subscriber = createRedisClient("subscriber");

export const REDIS_CHANNEL = "yjs-updates";

/**
 * Publish a Yjs binary update for a document to all server instances.
 * Payload format: "<docId>:<base64-encoded-update>"
 */
export async function publishUpdate(docId: string, update: Uint8Array) {
  if (!publisher) return;
  const payload = `${docId}:${Buffer.from(update).toString("base64")}`;
  await publisher.publish(REDIS_CHANNEL, payload);
}

/**
 * Subscribe to Yjs updates from other server instances.
 * Calls onMessage(docId, update) for each received update.
 */
export function subscribeToUpdates(
  onMessage: (docId: string, update: Uint8Array) => void
) {
  if (!subscriber) return;

  subscriber.subscribe(REDIS_CHANNEL, (err) => {
    if (err) console.error("Redis subscribe error:", err);
  });

  subscriber.on("message", (_channel, payload) => {
    const colonIdx = payload.indexOf(":");
    if (colonIdx === -1) return;
    const docId = payload.slice(0, colonIdx);
    const update = new Uint8Array(Buffer.from(payload.slice(colonIdx + 1), "base64"));
    onMessage(docId, update);
  });
}
