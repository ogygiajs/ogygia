// Ambient types for ogygia's build-time virtual modules and its `import.meta.og` surface. The library
// ships source (Region, OgygiaRouter, …) that imports the virtual modules; the ogygia vite plugin
// serves them at build time, but a consumer's `svelte-check`/`tsc` needs their declarations. Those
// are generated from the virtual-module table, one file per realm (./virtual/). Apps reach this
// file through `ogygia/types` (the `ogygia` package's ambient.d.ts references it).

// oxlint-disable typescript/triple-slash-reference -- ambient module declarations are global: an import would make this file a module
/// <reference path="./virtual/server.d.ts" />
/// <reference path="./virtual/boot.d.ts" />
/// <reference path="./virtual/region.d.ts" />
/// <reference path="./virtual/dev.d.ts" />
/// <reference path="./virtual/constants.d.ts" />
// oxlint-enable typescript/triple-slash-reference

// ── the `import.meta.og` compile surface ─────────────────────────────────────────────
// ogygia's build-time constructs, under ONE short key — platform-feeling like `import.meta.glob`,
// collision-proof by ownership, one autocomplete entry for the whole family. They are not runtime
// calls: the ogygia vite plugin rewrites each at transform time; these declarations are only types.
// The rule for what belongs here: literal inputs + a build-determined result.
interface ImportMeta {
	readonly og: ImportMetaOg;
}

/**
 * The `import.meta.og.*` constructs: core's below, plus each plugin's — a plugin package's own
 * types (`/// <reference types="@ogygia/content/types" />`) merge its macros into this interface.
 */
interface ImportMetaOg {
	/**
	 * The transportable mark — `static wire = import.meta.og.wire({ encode, decode })` on a
	 * class lets its instances cross island boundaries as props. A compile construct: the
	 * plugin CONSUMES the member and mints the symbol key (`static [Symbol.for('ogygia.wire')]
	 * = codec`), so the key never exists in source. STRICT: that member shape is the only
	 * legal position — any other use is a build error. ONE contract, always explicit:
	 * `{ encode, decode }` (+ optional `id`/`merge` for session continuity — see
	 * `TransportCodec` in `ogygia`).
	 */
	wire<T = unknown, D = unknown>(
		codec: import('@ogygia/core').TransportCodec<T, D>
	): import('@ogygia/core').TransportCodec<T, D>;
	/**
	 * Brand a value as TRANSPORTABLE so it crosses an island boundary LIVE — most often a closure
	 * (the wire's fn kind: the plugin hoists it to a self-contained factory, its captured locals
	 * becoming bound params), but also a store or an `og.wire` class instance the drop-in
	 * `setContext`/`og_derived` should carry live rather than freeze. Returns the SAME value (and
	 * type) — at the call site it reads as identity; the transform does the branding/hoisting. A
	 * branded closure must be self-contained (only its own captured locals + module imports, no
	 * `$app/*`).
	 */
	$<T>(value: T): T;
	/**
	 * @deprecated Gone: a build error that prints the import to write instead. Mark the import
	 * itself, named or default, with the same options:
	 * `import { Header as H } from '@design/system' with { wake: 'load' };`
	 */
	asRegion(component: unknown, options?: unknown): never;
	/**
	 * Declare a data source: `export const loadContent = import.meta.og.source(async (…) => …)`.
	 * Each call during a server render files a receipt (the source's `file#export` id plus a
	 * fingerprint of its arguments), so an invalidation names the function and its arguments
	 * instead of URL strings. Returns the SAME function. `opts.key` canonicalizes exotic
	 * arguments yourself (the default fingerprint is structural). Legal only as a top-level
	 * `export const`; anything else is a build error.
	 */
	source<A extends unknown[], R>(
		fn: (...args: A) => R,
		opts?: { key?: (...args: A) => string }
	): (...args: A) => R;
}
