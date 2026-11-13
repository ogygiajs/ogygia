/**
 * ogygia's compiler core — the pure source→source engine, decoupled from any build host.
 *
 * Everything here is side-effect-free: it takes source text plus a plain `ctx` bag and returns
 * `{ code, map, islands[] }`. It never calls `emitFile`, resolves virtual modules, or touches the
 * build graph — the caller (the Vite plugin, or a standalone Svelte preprocessor) owns that. That
 * is the whole point of the carve-out: the SAME rewrite must run in two places —
 *   - the Vite plugin (`ogygia/vite`), which consumes the returned `islands[]` to emit chunks, and
 *   - a standalone preprocessor, which runs under `svelte-check` / any non-Vite compile where the
 *     plugin never boots, so the marked `with { … }` imports still get rewritten and type-check.
 *
 * Anything build-specific (real chunk URLs, virtual-module ids) is expressed here only as PURE
 * naming functions (`islandPublicUrl`, `wrapperVirtualId`, …); they appear as string literals in
 * generated source and never gate type-checking, so a types-only run can pass placeholders.
 *
 * The DRIVER SPINE (`Compiler` / `Program` / `CompileCtx`) is the same carve-out one level up: a
 * long-lived, bundler-agnostic compile session (it imports no Vite) that fuses the file-local
 * front-end — `transform` (host islands), `ts_regions`, `macros`, and `prescan` (whole-app island
 * discovery) — over a `Program` (cross-file linker) and a resolved `CompileCtx`. Any non-Vite host
 * is just a second adapter: build a `CompileCtx`, make the `Compiler` with it, and
 * feed it source. The Vite plugin (`ogygia/vite`) is the reference adapter that drives it.
 *
 * Exposed to consumers as `ogygia/internal/compiler` (internal, not a stable public API).
 */
export * from './region/transform.ts';
export { parse_module, type AstNode } from './parse/oxc.ts';
export { parse_roots } from './parse/roots.ts';
export * from './fouc-css.ts';
export * from './free-vars.ts';
export { Compiler, type Profiler } from './driver.ts';
export { Program, strip_id, host_key } from './program.ts';
export { CompileCtx, type CompileCtxInit } from './ctx.ts';
export { node_fs, memory_fs, type Fs, type FsEntry, type MemoryFs } from './fs.ts';
export * from './ids.ts';
// What an import-rewriting plugin reads modules with (@ogygia/barrels).
export {
	ExportIndex,
	Shapes,
	type Change,
	type ExportMap,
	type Leaf,
	type Policy
} from './exports/index.ts';
export { analyze_imports, type ImportDecl, type ImportSpec } from './exports/parse.ts';
export { blank_styles } from './blank-styles.ts';
export { is_script_request } from './script-request.ts';
// How a dev module id says it is generated or ogygia's own (devtools' per-island byte walk).
export { OGYGIA_SCHEME } from './virtual/table.ts';
export { OWN_FILE_RE } from '@ogygia/core/contract';
// the build's message tables, for the docs' `ogygiajs.dev/e` pages
export { BUILD_ERRORS, BUILD_WARNINGS } from './messages.ts';
// The building blocks of an `import.meta.og.*` macro, for first-party plugins' macros (content's
// `code` / `md` / `loader` / `regions` / `git`, `@ogygia/bake`'s `bake`): the call scanner, the member
// matcher, the build cache.
export {
	find_og_calls,
	split_first_string,
	og_js_regions,
	is_js_module,
	type OgCall,
	type JsRegion
} from './parse/scan.ts';
export { og_member } from './macros/wire.ts';
export { BuildCache, configure_build_cache, __set_build_cache_root } from './build-cache.ts';
export { content_css_key } from '@ogygia/core/contract';
export { dedent } from '@ogygia/core/contract';
