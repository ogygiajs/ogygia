/**
 * postrender — tier-2 store on Upstash Redis (REST). Serverless-native: no client library, no
 * connection — every command is one signed HTTPS call, which is exactly what edge/lambda origins
 * want. Same key scheme as the valkey adapter (`og:a:<pathname>`, `og:t:<tag>` sets).
 *
 *   postrender.handle({ store: new UpstashStore({ url: env.UPSTASH_REDIS_REST_URL,
 *                                                 token: env.UPSTASH_REDIS_REST_TOKEN }) })
 */
import { net } from '@ogygia/machine';
import type { PostrenderEntry, PostrenderPutOptions, PostrenderStore } from '../types.ts';
import { normalize_prefix, subtree_prefix } from '../key.ts';
import { OgygiaError } from '../messages.ts';

// ── regexes
const GLOB_ACTIVE_G = /[*?[\]\\]/g;
const TRAILING_SLASHES_RE = /\/+$/;

const KEY_NS = 'og:a:';
const TAG_NS = 'og:t:';
const SCAN_COUNT = 250;

export interface UpstashConfig {
	/** The REST endpoint, e.g. `https://usw1-xxxx.upstash.io`. */
	url: string;
	token: string;
}

/** Escape glob-active characters so a literal pathname can ride a SCAN MATCH pattern. */
function glob_escape(value: string): string {
	return value.replace(GLOB_ACTIVE_G, (c) => `\\${c}`);
}

export class UpstashStore implements PostrenderStore {
	#base: string;
	#token: string;

	constructor(config: UpstashConfig) {
		this.#base = config.url.replace(TRAILING_SLASHES_RE, '');
		this.#token = config.token;
	}

	async get(key: string): Promise<PostrenderEntry | null> {
		const raw = await this.#command<string | null>(['GET', KEY_NS + key]);
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
		await this.#command(['SET', KEY_NS + key, JSON.stringify(entry), 'EX', ttl]);
		for (const tag of tags ?? []) {
			await this.#command(['SADD', TAG_NS + tag, key]);
			// A tag set is shared by entries of different lifetimes: only ever EXTEND its expiry,
			// or a short-lived entry would expire the index of a long-lived page sharing the tag.
			// (TTL then EXPIRE, not `EXPIRE … GT`: GT treats a fresh set as never-expiring.)
			const left = await this.#command<number>(['TTL', TAG_NS + tag]);
			if (left < ttl) await this.#command(['EXPIRE', TAG_NS + tag, ttl]);
		}
	}

	async evict(key: string): Promise<void> {
		await this.#command(['DEL', KEY_NS + key]);
	}

	async evictWhere({ prefix }: { prefix: string }): Promise<void> {
		const p = normalize_prefix(prefix);
		const pattern = `${glob_escape(KEY_NS + subtree_prefix(p))}*`;
		let cursor = '0';
		do {
			const reply = await this.#command<[string, string[]]>([
				'SCAN',
				cursor,
				'MATCH',
				pattern,
				'COUNT',
				SCAN_COUNT
			]);
			cursor = String(reply[0]);
			if (reply[1]?.length) await this.#command(['DEL', ...reply[1]]);
		} while (cursor !== '0');
		await this.#command(['DEL', KEY_NS + p]);
	}

	async evictByTag(tag: string): Promise<string[]> {
		const members = await this.#command<string[]>(['SMEMBERS', TAG_NS + tag]);
		if (members.length) await this.#command(['DEL', ...members.map((m) => KEY_NS + m)]);
		await this.#command(['DEL', TAG_NS + tag]);
		return members;
	}

	/** One command, Upstash REST shape: POST the command as a JSON array → `{ result }`. */
	async #command<T>(parts: (string | number)[]): Promise<T> {
		const res = await net.fetch(this.#base, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${this.#token}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(parts.map(String))
		});
		if (!res.ok) {
			throw new OgygiaError('postrender_adapter_request_failed', {
				what: 'upstash command',
				status: res.status,
				body: await res.text().catch(() => '')
			});
		}
		return ((await res.json()) as { result: T }).result;
	}
}
