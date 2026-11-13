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
	 * Mark an imported component as a region — the macro alternative to `import X from '…' with
	 * { … }`, and the escape hatch for BARRELS. The import-attribute form only reaches a DEFAULT
	 * import of one file; `asRegion` marks ANY imported component, including a NAMED export from a
	 * barrel (`import { Header } from '@design/system'`). It is a transparent escape hatch: the
	 * `options` accept EXACTLY what an import attribute accepts — no more, no less — and the output
	 * is identical, only importing the component by its export name. Every mode works: a placed
	 * island (`wake`), a deferred/live server hole (`render`), a lake (`wake: 'none'`), a held
	 * region (`region: 'raw'`), or a named `preset`.
	 *
	 * `component` must be a bare identifier bound to a top-level import, and the call must be a
	 * TOP-LEVEL `const Name = import.meta.og.asRegion(Comp, …)` in the instance `<script>`. Returns
	 * a component with the SAME props. Compile construct — rewritten to a hoisted binding import;
	 * there is no runtime `asRegion`.
	 */
	asRegion<C>(
		component: C,
		options: {
			/** hydrate schedule (placed island / lake at `'none'`); the fetch schedule for `render`. */
			wake?: 'load' | 'idle' | 'visible' | 'interaction' | 'none' | (string & {});
			/** delivery mode: a static island (default), or a `'deferred'` / `'live'` server hole. */
			render?: 'static' | 'deferred' | 'live';
			/** a held region handed to `region()` — must be the ONLY option (`'raw'`). */
			region?: 'raw';
			/** a named preset from `ogygia({ presets })` — must be the ONLY option. */
			preset?: string;
			/** keep the live island (DOM + state) across SPA navigations. */
			keep?: string;
		}
	): C;
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
