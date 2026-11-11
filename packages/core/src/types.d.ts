// Ambient declarations for the library's own build: its virtual modules (generated from the table,
// one file per realm) and the Kit modules it references. These make `tsc --noEmit` clean; they are
// not shipped (excluded from tsdown entry).

// oxlint-disable typescript/triple-slash-reference -- ambient module declarations are global: an import would make this file a module
/// <reference path="../virtual/server.d.ts" />
/// <reference path="../virtual/boot.d.ts" />
/// <reference path="../virtual/region.d.ts" />
/// <reference path="../virtual/dev.d.ts" />
// oxlint-enable typescript/triple-slash-reference

/** CONTINUITY compile-time constants (Vite `define`; typeof-guarded so node dist import is safe). */
declare const __OGYGIA_CONTINUITY_FORMS__: boolean;
/** SERVER-DELTA NAV opt-in (Vite `define`; default OFF — see `router.serverDelta`). */
declare const __OGYGIA_SERVER_DELTA__: boolean;
/** DEVTOOLS event layer gate (Vite `define`; default OFF — see `ogygia({ devtools })`). When off,
 *  every `if (DEVTOOLS) emit({…})` folds to `if (false)` and the whole bus tree-shakes away. */
declare const __OGYGIA_DEVTOOLS__: boolean;
/** a build with devtools on: launcher only; the dock and the page measuring start once opened */
declare const __OGYGIA_DEVTOOLS_LAZY__: boolean;
/** ogygia's rules on itself are built in (`OGYGIA_RULES=1` at build time: the e2e suites'; always on
 *  in dev). Off, every `if (RULES) …` folds out and no rule ships (src/rules.ts). */
declare const __OGYGIA_RULES__: boolean;
/** the profiler's browser half ships (the profiler or devtools is configured); otherwise every
 *  `if (BEACON) …` folds out and runtime/beacon.ts leaves the bundle */
declare const __OGYGIA_BEACON__: boolean;
/** a plugin's browser half (`<plugin>/client`) is in the boot: the runtime calls its hooks */
declare const __OGYGIA_CLIENT_PLUGINS__: boolean;
/** The app's Kit major version (2, 3), or null when the plugin found none (kit-paths.ts). */
declare const __OGYGIA_KIT_MAJOR__: number | null;
/** The installed ogygia's version, which the runtime discloses (runtime/disclose-version.ts). */
declare const __OGYGIA_VERSION__: string;

declare module '$app/paths' {
	export const base: string;
	export const assets: string;
	export function resolve(id: string, params?: Record<string, string>): string;
	export function asset(file: string): string;
}
// `$app/env` (Kit ≥ 2.70 and Kit 3; Kit 3 deprecates `$app/environment`)
declare module '$app/env' {
	export const building: boolean;
	export const browser: boolean;
	export const dev: boolean;
	export const version: string;
}
declare module '$app/server' {
	export function getRequestEvent(): {
		cookies: { get: (name: string) => string | undefined };
		request: Request;
		[key: string]: unknown;
	};
}

// Minimal ambient for the Kit type the library imports (`RequestEvent`). The lib does not depend on
// @sveltejs/kit; the CONSUMER's real Kit types back the shipped `dist/hooks.d.ts` (`@sveltejs/kit`
// is externalised by tsdown). `Handle` is the library's own (kit-handle.ts: Kit 3 moved Kit's). Not
// shipped (types.d.ts is excluded from tsdown).
declare module '@sveltejs/kit' {
	export interface RequestEvent {
		url: URL;
		[key: string]: unknown;
	}
}

// Kit's INTERNAL server request store (deep import, same posture as the vite deep-imports).
// `get_request_store()` returns the live per-request state; `state.remote` is the map Kit
// populates during a csr=false render but only serializes when csr===true (see hooks.ts). Only
// the fields the flicker-seeding path reads are declared. Not shipped (types.d.ts excluded).
declare module '@sveltejs/kit/internal/server' {
	export interface RemoteInternals {
		id: string;
		type: string;
	}
	export interface RequestRemoteState {
		implicit: Map<RemoteInternals, Record<string, () => Promise<unknown>>> | null;
		// oxlint-disable-next-line ogygia/no-promise-cache -- the shape of SvelteKit's own per-request remote state, declared, not ours to change
		data: Map<RemoteInternals, Record<string, Promise<unknown>>> | null;
	}
	export interface RequestState {
		transport?: Record<
			string,
			{ encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }
		>;
		remote: RequestRemoteState;
	}
	export interface RequestStore {
		event: unknown;
		state: RequestState;
	}
	export function get_request_store(): RequestStore;
	export function try_get_request_store(): RequestStore | null;
	export function with_request_store<T>(store: RequestStore | null, fn: () => T): T;
}

interface Window {
	// Dev-only devtools maps the dock fetches from the plugin's `/__ogygia_devtools_meta` middleware.
	// `names`: island id → component name (tab labels). `bytes`: island id → transitive dev-module
	// size (the Bytes tab's real-cost estimate). Absent off a devtools build.
	__ogygia_region_names?: Record<string, string>;
	__ogygia_region_bytes?: Record<
		string,
		{
			bytes: number;
			modules: number;
			top?: { file: string; bytes: number }[];
			barrels?: { file: string; fanout: number }[];
		}
	>;
}

// Rune globals used by the `.svelte.ts` shims. Those files are compiled by the CONSUMER's
// svelte pipeline (which understands runes); this ambient declaration only satisfies the
// library's own plain `tsc` type-check. Not shipped (types.d.ts is excluded from tsdown).
declare function $state<T>(initial: T): T;
