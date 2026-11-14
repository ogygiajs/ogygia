// Ambient declarations for the library's own build: its virtual modules (generated from the table,
// one file per realm) and the Kit modules it references. These make `tsc --noEmit` clean; they are
// not shipped (excluded from tsdown entry).

// oxlint-disable typescript/triple-slash-reference -- ambient module declarations are global: an import would make this file a module
/// <reference path="../virtual/server.d.ts" />
/// <reference path="../virtual/boot.d.ts" />
/// <reference path="../virtual/region.d.ts" />
/// <reference path="../virtual/dev.d.ts" />
/// <reference path="../virtual/constants.d.ts" />
// oxlint-enable typescript/triple-slash-reference

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
		remote: RequestRemoteState;
	}
	export interface RequestStore {
		event: unknown;
		state: RequestState;
	}
	export function get_request_store(): RequestStore;
	export function try_get_request_store(): RequestStore | null;
	export function with_request_store<T>(store: RequestStore | null, fn: () => T): T;
	export function getRequestEvent(): unknown;
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
			barrels?: import('./contract/barrels.ts').IslandBarrel[];
		}
	>;
}

// Rune globals used by the `.svelte.ts` shims. Those files are compiled by the CONSUMER's
// svelte pipeline (which understands runes); this ambient declaration only satisfies the
// library's own plain `tsc` type-check. Not shipped (types.d.ts is excluded from tsdown).
declare function $state<T>(initial: T): T;
