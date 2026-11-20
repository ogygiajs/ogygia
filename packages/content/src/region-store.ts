/**
 * The REGION STORE — the CONTENT pillar's persistent home for SERIALIZED REGIONS. Node-only.
 *
 * It lives in content deliberately: a region is storable exactly when its input is DATA (markdown
 * text, block JSON, any compiled format) — and input-is-data is what defines the content pillar.
 * Pure-runtime regions (inline component awaits, server islands, lakes) render components + live
 * state: no content address exists for them, and freshness is their point — they are NOT producers.
 *
 * A serialized region is the framework's one content currency: `{ html }` today, growing island
 * descriptors (and hover payloads, etc.) WITH the region contract — never a bespoke per-producer
 * format. Every producer harnesses the same store with its own namespace:
 *
 *   - `new RegionStore('fences')` — the fence pipeline (one region per rendered code block)
 *   - `new RegionStore('docs')`   — the markdown region emitter (one region per document)
 *   - future: CMS block bakes, on-demand publishes, incremental-build inputs, edge push
 *
 * Addressing is content-hashing over producer-supplied parts (`store.key([...])`) — no invalidation
 * logic anywhere: changed input = different address, stale entries sit until pruned. Persistence
 * rides the shared {@link BuildCache} (`node_modules/.ogygia/<namespace>/`), so build platforms that
 * cache `node_modules` keep every baked region across builds.
 */
import { createHash, type Hash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildCache } from '@ogygia/compiler';

/** Hashes the code a module ships with: every file of the top folder it sits in below its package
 *  root (`src` in the workspace, `dist` when installed), or the module alone at the root. */
function hash_shipped(h: Hash, file: string): void {
	let top = file;
	let dir = path.dirname(file);
	while (!fs.existsSync(path.join(dir, 'package.json'))) {
		const up = path.dirname(dir);
		if (up === dir) break;
		top = dir;
		dir = up;
	}
	const files =
		top === file ? [''] : fs.readdirSync(top, { recursive: true, encoding: 'utf8' }).sort();
	for (const rel of files) {
		const p = path.join(top, rel);
		if (!fs.statSync(p).isFile()) continue;
		h.update(rel);
		h.update('\0');
		h.update(fs.readFileSync(p));
		h.update('\0');
	}
}

/** What a stored region's code runs through: this package and the compiler and core it calls. */
const PRODUCERS: readonly string[] = ['@ogygia/compiler', '@ogygia/core/plugin/utils'];

/** A region in its serialized form — what crosses caches, wires, and builds. `html` is the whole
 *  baked markup; `islands` is reserved for descriptor-carrying regions (the wake list). */
export type SerializedRegion = {
	html: string;
	islands?: Array<Record<string, unknown>>;
};

export class RegionStore {
	static #code: string | undefined;

	/** The producers' code, read once: a change to any of it, released or not, is a new address. */
	static code(): string {
		if (RegionStore.#code !== undefined) return RegionStore.#code;
		const h = createHash('sha256');
		const here = fileURLToPath(import.meta.url);
		const require = createRequire(here);
		for (const file of [here, ...PRODUCERS.map((p) => require.resolve(p))]) hash_shipped(h, file);
		return (RegionStore.#code = h.digest('hex'));
	}

	readonly #cache: BuildCache<SerializedRegion>;

	/** `namespace` is the store's directory inside the shared cache. */
	constructor(namespace: string) {
		this.#cache = new BuildCache<SerializedRegion>(namespace);
	}

	/** A stable address from the parts that shape a region's content. */
	key(parts: ReadonlyArray<string>): string {
		const h = createHash('sha256');
		h.update(RegionStore.code());
		for (const p of parts) {
			h.update('\0');
			h.update(p);
		}
		return h.digest('hex').slice(0, 40);
	}

	get(key: string): SerializedRegion | null {
		return this.#cache.get(key);
	}

	set(key: string, region: SerializedRegion): void {
		this.#cache.set(key, region);
	}
}
