/**
 * A stand-in for the `redis` package (node-redis; the tests' `redis` is this file: vitest.config.ts).
 * Connecting takes a turn of the event loop, like a real round trip.
 */
export const made: object[] = [];

export function createClient(_options: { url: string }) {
	const kv = new Map<string, string>();
	const client = {
		connect: () => new Promise<void>((r) => setImmediate(r)),
		set: async (k: string, v: string) => void kv.set(k, v),
		get: async (k: string) => kv.get(k) ?? null,
		del: async () => undefined,
		zAdd: async () => undefined,
		zRem: async () => undefined,
		zRange: async () => [],
		zCard: async () => 0,
		quit: async () => undefined
	};
	made.push(client);
	return client;
}
