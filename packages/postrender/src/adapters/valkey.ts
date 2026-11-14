import type { PostrenderEntry, PostrenderPutOptions, PostrenderStore } from '../types.ts';
import { normalize_prefix, subtree_prefix } from '../key.ts';
import { OgygiaError } from '../messages.ts';

const GLOB_ACTIVE_G = /[*?[\]\\]/g;

const KEY_NS = 'og:a:';
const TAG_NS = 'og:t:';
const SCAN_COUNT = 250;

/** The minimal client surface — ioredis (lowercase) and node-redis v4 (camelCase) both satisfy
 *  it structurally; the camelCase variants are probed at call time. */
export interface ValkeyLike {
	get(key: string): Promise<string | null>;
	/** ioredis-style positional EX; node-redis v4 accepts (key, value, { EX }) — both supported. */
	set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
	del(...keys: string[]): Promise<unknown>;
	scan(cursor: string | number, ...args: unknown[]): Promise<unknown>;
	sadd?(key: string, ...members: string[]): Promise<unknown>;
	sAdd?(key: string, members: string | string[]): Promise<unknown>;
	smembers?(key: string): Promise<string[]>;
	sMembers?(key: string): Promise<string[]>;
	expire?(key: string, seconds: number): Promise<unknown>;
	ttl?(key: string): Promise<number>;
	TTL?(key: string): Promise<number>;
}

function read_scan_reply(reply: unknown): { cursor: string; keys: string[] } {
	if (Array.isArray(reply)) {
		return { cursor: String(reply[0]), keys: (reply[1] as string[]) ?? [] };
	}
	const obj = reply as { cursor: string | number; keys: string[] };
	return { cursor: String(obj.cursor), keys: obj.keys ?? [] };
}

function glob_escape(value: string): string {
	return value.replace(GLOB_ACTIVE_G, (c) => `\\${c}`);
}

/**
 * A store on Valkey or Redis, with the app's own client (ioredis and node-redis v4 both fit
 * {@link ValkeyLike}; ogygia takes no Redis dependency). Keys are `og:a:<pathname>` with `EX` as
 * the TTL backstop; prefix eviction is a cursor SCAN, so no index can drift. Each `og.source` tag
 * is a SET of pathnames whose expiry a put only ever extends, to the longest lifetime among its
 * members.
 */
export class ValkeyStore implements PostrenderStore {
	#client: ValkeyLike;

	constructor(client: ValkeyLike) {
		this.#client = client;
	}

	async get(key: string): Promise<PostrenderEntry | null> {
		const raw = await this.#client.get(KEY_NS + key);
		if (!raw) return null;
		try {
			return JSON.parse(raw);
			// oxlint-disable-next-line ogygia/no-silent-failures -- an entry that does not parse is a miss: the page renders again
		} catch {
			return null;
		}
	}

	async put(
		key: string,
		entry: PostrenderEntry,
		{ ttl, tags }: PostrenderPutOptions
	): Promise<void> {
		await this.#set_with_ttl(KEY_NS + key, JSON.stringify(entry), ttl);
		for (const tag of tags ?? []) {
			await this.#sadd(TAG_NS + tag, key);
			// @why `EXPIRE … GT` treats a set with no expiry as never expiring, so it would never set the first one; TTL then EXPIRE does (test: test/postrender.test.ts › a longer-lived entry extends the tag set)
			const left = await this.#read_ttl(TAG_NS + tag);
			if (left === null || left < ttl) await this.#client.expire?.(TAG_NS + tag, ttl);
		}
	}

	async evict(key: string): Promise<void> {
		await this.#client.del(KEY_NS + key);
	}

	async evictWhere({ prefix }: { prefix: string }): Promise<void> {
		const client = this.#client;
		const p = normalize_prefix(prefix);
		await this.#scan_prefix(subtree_prefix(p), async (keys) => void (await client.del(...keys)));
		await client.del(KEY_NS + p);
	}

	async evictByTag(tag: string): Promise<string[]> {
		const client = this.#client;
		const members = await this.#smembers(TAG_NS + tag);
		if (members.length) await client.del(...members.map((m) => KEY_NS + m));
		await client.del(TAG_NS + tag);
		return members;
	}

	async #set_with_ttl(key: string, value: string, ttl: number): Promise<void> {
		try {
			// @why ioredis takes `SET key value EX ttl` positionally; node-redis v4 throws on that form and takes `{ EX }` instead (test: test/postrender.test.ts › speaks node-redis v4: SET with an options bag after the positional form throws, and an object SCAN reply)
			await this.#client.set(key, value, 'EX', ttl);
		} catch {
			await this.#client.set(key, value, { EX: ttl } as unknown as string);
		}
	}

	async #sadd(key: string, member: string): Promise<void> {
		const client = this.#client;
		if (client.sadd) await client.sadd(key, member);
		else if (client.sAdd) await client.sAdd(key, member);
		else
			throw new OgygiaError('postrender_store_client_missing', {
				client: 'valkey',
				commands: 'sadd/sAdd'
			});
	}

	async #smembers(key: string): Promise<string[]> {
		const client = this.#client;
		if (client.smembers) return client.smembers(key);
		if (client.sMembers) return client.sMembers(key);
		throw new OgygiaError('postrender_store_client_missing', {
			client: 'valkey',
			commands: 'smembers/sMembers'
		});
	}

	/** Seconds left on a key (-1 = no expiry), or null when the client has no TTL command. */
	async #read_ttl(key: string): Promise<number | null> {
		const client = this.#client;
		if (client.ttl) return Number(await client.ttl(key));
		if (client.TTL) return Number(await client.TTL(key));
		return null;
	}

	async #scan_prefix(prefix: string, on_keys: (keys: string[]) => Promise<void>): Promise<void> {
		const pattern = `${glob_escape(KEY_NS + prefix)}*`;
		let cursor = '0';
		do {
			const reply = await this.#client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
			const page = read_scan_reply(reply);
			cursor = page.cursor;
			if (page.keys.length) await on_keys(page.keys);
		} while (cursor !== '0');
	}
}
