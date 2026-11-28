/** Decision trie stored at `pathname` when a page reads bounded `flag()` variants. */
export type VariantTrieNode =
	| { kind: 'leaf'; key: string }
	| { kind: 'branch'; flag: string; arms: Record<string, VariantTrieNode> };

/** A stored page: a finished page response, a permanent redirect, or a variant decision trie. */
export type PostrenderEntry =
	| {
			kind: 'page';
			html: string;
			/** Index of `</head>` in `html` — where a served-from-store copy gets its doc marker
			 *  stamped by slicing (no copy of the page per hit). Absent on entries written before
			 *  the field existed; the read side then finds it once. */
			head_end?: number;
			/** Headers to replay on a hit (content-type + the verdict's cache-control + edge extras). */
			headers: Record<string, string>;
			/** Epoch ms at store time — the read side's TTL backstop (a page older than the TTL is a miss). */
			created: number;
			/** The build that stored it (Kit's `version.name`): it is served to that build only, and is
			 *  a miss for any other (absent: stored before builds were recorded, a miss too). */
			build?: string;
			/** The shell contains serve-time STITCH holes: every serve re-renders them with the
			 *  visitor's request and splices — per-visitor responses, `private, no-store`, no
			 *  validators. See postrender/stitch.ts. */
			stitch?: boolean;
	  }
	| {
			kind: 'redirect';
			status: 301 | 308;
			location: string;
			created: number;
			/** The build that stored it: as a page's. */
			build?: string;
	  }
	| {
			kind: 'variants';
			trie: VariantTrieNode;
			created: number;
			build?: string;
	  };

/** Options `put` receives beyond the entry. */
export interface PostrenderPutOptions {
	/** How long to keep the entry, in seconds: for a page, the TTL backstop (≤ 86400); for the build
	 *  marker the deploy thaw keeps (a NUL-prefixed key), years. A store with native expiry (valkey
	 *  EX) uses it directly. Either way postrender also ages a page on read against `entry.created`,
	 *  so a page from a store without expiry is a miss once it is older than the TTL. */
	ttl: number;
	/** Source receipts recorded during the render (`s:<id>:<fp>` from `import.meta.og.source`
	 *  wrappers) — the REVERSE INDEX feeding `evictByTag`. Empty/omitted = no receipts. */
	tags?: string[];
}

/**
 * The store contract — four calls. Implementations MUST pass the shared contract spec
 * (test/postrender.test.ts): tier-1 memory ships built-in; valkey rides `REDIS_URL` infra.
 * Keys are URL pathnames, so `evictWhere({ prefix })` is a key-prefix scan by construction.
 */
export interface PostrenderStore {
	get(key: string): Promise<PostrenderEntry | null>;
	put(key: string, entry: PostrenderEntry, options: PostrenderPutOptions): Promise<void>;
	evict(key: string): Promise<void>;
	evictWhere(filter: { prefix: string }): Promise<void>;
	/** The reverse index (og.source precision): evict every key whose receipts carry `tag` and
	 *  RETURN those keys — ogygia fans the returned URLs out to the edge adapters' `purgeUrl`.
	 *  Optional: a store without it degrades `invalidate(fn, args)` to a warning. */
	evictByTag?(tag: string): Promise<string[]>;
	/** Optional introspection for harnesses/devtools: number of live entries. */
	size?(): Promise<number>;
}

/** What `EdgeAdapter.headers` receives — enough to write the edge's storage instructions. */
export interface PostrenderMeta {
	/** Request pathname (the store key). */
	url: string;
	/** The policy TTL in seconds (the s-maxage the verdict grants). */
	ttl: number;
	/** Bounded flag variants read during this render (`[flagName, variant]`), if any. */
	variants?: ReadonlyArray<readonly [string, string]>;
	/** App-emitted and source cache tags associated with this response. */
	tags?: readonly string[];
}

/**
 * The edge contract. `headers(meta)` returns extra response headers the CDN stores by —
 * Akamai stamps depth-capped PREFIX tags (`og_p/fr`, `og_p/fr/fr`, …) since Fast Purge can't take
 * an arbitrary prefix; CloudFront needs none (path wildcards are native). `purgeUrl`/`purgeWhere`
 * (and optional `purgeTags`) speak the CDN's REAL purge API. Adapters never fan out — ogygia calls
 * every edge with `allSettled` (one edge down ≠ publish down).
 */
export interface EdgeAdapter {
	/** Adapter name for logs/harness assertions ("akamai", "cloudfront"). */
	name: string;
	headers(meta: PostrenderMeta): Record<string, string>;
	purgeUrl(url: string): Promise<void>;
	purgeWhere(filter: { prefix: string }): Promise<void>;
	purgeTags?(tags: readonly string[]): Promise<void>;
}

/** `postrender.handle({ … })` — the live objects (clients, creds) a server keeps its pages with. */
export interface PostrenderHandleOptions {
	/** Where pages are kept (default: an in-process memory store). */
	store?: PostrenderStore;
	/** The CDNs in front of the app, purged on every invalidation. */
	edge?: EdgeAdapter[];
}
