import type { PostrenderEntry, PostrenderPutOptions, PostrenderStore } from '../types.ts';
import { normalize_prefix, subtree_prefix } from '../key.ts';

const KEY_NS = 'og:a:';
const TAG_NS = 'og:t:';
const KV_MIN_TTL = 60;

/** The minimal Workers KV binding surface (KVNamespace, structurally). */
export interface KvNamespaceLike {
	get(key: string, type: 'text'): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
	list(options: {
		prefix: string;
		cursor?: string;
	}): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

/**
 * A store on Cloudflare Workers KV, with the Worker's own binding. KV has no sets and no scans but
 * lists by key prefix: pages are `og:a:<pathname>` (subtree eviction is one list) and each tag is
 * a set of sentinel keys `og:t:<tag>:<pathname>` (tag eviction is one list).
 *
 * Differences from the other stores: KV is eventually consistent (an invalidation can serve the
 * old copy for about a minute at far locations), and a TTL under 60 seconds is raised to 60, KV's
 * floor.
 *
 *   import { env } from 'cloudflare:workers';
 *   postrender.handle({ store: new CloudflareKvStore(env.PAGES) })
 */
export class CloudflareKvStore implements PostrenderStore {
	#kv: KvNamespaceLike;

	constructor(kv: KvNamespaceLike) {
		this.#kv = kv;
	}

	async get(key: string): Promise<PostrenderEntry | null> {
		const raw = await this.#kv.get(KEY_NS + key, 'text');
		if (!raw) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}

	async put(
		key: string,
		entry: PostrenderEntry,
		{ ttl, tags }: PostrenderPutOptions
	): Promise<void> {
		const kv = this.#kv;
		const expirationTtl = Math.max(KV_MIN_TTL, ttl);
		await kv.put(KEY_NS + key, JSON.stringify(entry), { expirationTtl });
		for (const tag of tags ?? []) {
			await kv.put(`${TAG_NS}${tag}:${key}`, '1', { expirationTtl });
		}
	}

	async evict(key: string): Promise<void> {
		await this.#kv.delete(KEY_NS + key);
	}

	async evictWhere({ prefix }: { prefix: string }): Promise<void> {
		const kv = this.#kv;
		const p = normalize_prefix(prefix);
		for (const name of await this.#list_prefix(KEY_NS + subtree_prefix(p))) await kv.delete(name);
		await kv.delete(KEY_NS + p);
	}

	async evictByTag(tag: string): Promise<string[]> {
		const kv = this.#kv;
		const sentinel_prefix = `${TAG_NS}${tag}:`;
		const sentinels = await this.#list_prefix(sentinel_prefix);
		const keys: string[] = [];
		for (const name of sentinels) {
			const key = name.slice(sentinel_prefix.length);
			keys.push(key);
			await kv.delete(KEY_NS + key);
			await kv.delete(name);
		}
		return keys;
	}

	async #list_prefix(prefix: string): Promise<string[]> {
		const names: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await this.#kv.list({ prefix, cursor });
			for (const k of page.keys) names.push(k.name);
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor);
		return names;
	}
}
