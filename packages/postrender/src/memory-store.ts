/**
 * postrender — tier-1 store: in-process byte-bounded LRU with TTL backstop + the tag reverse index
 * (og.source receipts). The zero-infra default (`postrender.handle()` with no `store`):
 * single-instance adapter-node. Replicas / serverless want tier 2 (valkey / upstash) — a
 * per-instance LRU there means per-instance misses AND invalidation blind spots.
 */
import type { PostrenderEntry, PostrenderPutOptions, PostrenderStore } from './types.ts';
import { in_subtree, normalize_prefix } from './key.ts';
import { SizedLru } from '@ogygia/core/plugin/utils';
import { clock } from '@ogygia/machine';

/** Resident budget for stored pages (a stored page can be multi-MB; a count alone bounds nothing). */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 1000;

/** What an entry costs to keep: a page is its HTML; a redirect is a few dozen bytes. */
const entry_bytes = (entry: PostrenderEntry): number =>
	entry.kind === 'page' ? entry.html.length : 64;

export class MemoryStore implements PostrenderStore {
	#entries: SizedLru<PostrenderEntry>;
	// tag → keys (og.source receipts). Dead keys are tolerated (evicted entries leave their tag
	// refs behind; a later evictByTag deleting a gone key is a no-op) — no sweep bookkeeping.
	#tag_index = new Map<string, Set<string>>();

	constructor(max_entries: number = DEFAULT_MAX_ENTRIES, max_bytes: number = DEFAULT_MAX_BYTES) {
		this.#entries = new SizedLru<PostrenderEntry>(max_bytes, max_entries);
	}

	async get(key: string): Promise<PostrenderEntry | null> {
		return this.#entries.get(key, clock.mono());
	}

	async put(key: string, entry: PostrenderEntry, options: PostrenderPutOptions): Promise<void> {
		this.#entries.set(key, entry, entry_bytes(entry), clock.mono() + options.ttl * 1000);
		for (const tag of options.tags ?? []) {
			let set = this.#tag_index.get(tag);
			if (!set) this.#tag_index.set(tag, (set = new Set()));
			set.add(key);
		}
	}

	async evict(key: string): Promise<void> {
		this.#entries.delete(key);
	}

	async evictWhere({ prefix }: { prefix: string }): Promise<void> {
		// Keys ARE pathnames — a subtree eviction is a startsWith scan. `/fr/fr` matches
		// `/fr/fr` itself and everything under `/fr/fr/`, never `/fr/fright`.
		const p = normalize_prefix(prefix);
		const entries = this.#entries;
		for (const key of entries.keys()) {
			if (in_subtree(key, p)) entries.delete(key);
		}
	}

	async evictByTag(tag: string): Promise<string[]> {
		const set = this.#tag_index.get(tag);
		if (!set) return [];
		this.#tag_index.delete(tag);
		const evicted: string[] = [];
		for (const key of set) {
			if (this.#entries.delete(key)) evicted.push(key);
		}
		return evicted;
	}

	async size(): Promise<number> {
		// Sweep expired so harness counts reflect live entries only.
		this.#entries.sweep(clock.mono());
		return this.#entries.size;
	}
}
