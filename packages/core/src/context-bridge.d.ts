import { type SetContextOptions } from './context-registry.ts';
/** Serialize a context value for the DOM — same codec as island props (one hub key). */
export declare function serialize_context(value: unknown): string;
export declare function serialize_provided_context(map: Map<string, unknown>): string | null;
/**
 * Walk up from an island being hydrated, collecting every `<ogygia-provide>` above it (nearest wins)
 * into one Map, then fold in the single page-level `<script data-ogygia-provide-page>` marker as the
 * ROOT (lowest priority). ogygia seeds `hydrate(…, { context })` with the Map, so a child island's own
 * `getContext('key')` — unchanged — reads a layout's context across the island-root split on a
 * csr=false page.
 *
 * Two providers feed it: a `<Provide>` component (scoped, walked up — nesting/shadowing correct), and
 * the drop-in `setContext` (page marker — one flat root the whole page shares, for existing layouts
 * that just import `setContext` from `ogygia`). Scoped beats root on the same key. Undefined when
 * neither exists (the common case: nothing to seed, no cost). Same decode codec as island props (a
 * `[ogygia.wire]` value revives to its one live instance).
 */
export declare function collect_provided_context(start: Element | null): Map<string, unknown> | undefined;
/** A typed context handle: callable to make a `<Provide>` entry, `.get()` to read (typed). */
export interface Context<T> {
    /** `theme('dark')` → `{ theme: 'dark' }` — an entry for `<Provide values={[ … ]}>`. */
    (value: T): Record<string, unknown>;
    /** Typed read — plain `getContext(key)` under the hood (seeded across islands), or the default. */
    get(): T | undefined;
    /** The underlying string key, for `getContext(theme.key)` interop. */
    readonly key: string;
}
/**
 * Typed sugar over a string context key, shared with plain `getContext`. Callable to produce a
 * `<Provide>` entry, `.get()` to read (typed). The key is the same string plain `getContext` uses, so
 * typed and untyped code read the same context. An optional default is returned when nothing is
 * provided above.
 *
 * ```ts
 * export const theme = createContext<'light' | 'dark'>('theme', 'light');
 * // provide: <Provide values={[ theme('dark') ]}>…</Provide>
 * // read:    theme.get()          // typed
 * //          getContext('theme')  // untyped — same key, same value
 * ```
 */
export declare function createContext<T>(key: string, defaultValue?: T): Context<T>;
/**
 * Drop-in `setContext` — swap `import { setContext } from 'svelte'` for `from 'ogygia'` and an
 * existing csr=false layout's context reaches child islands with NO other change.
 *
 * It does exactly what Svelte's does (sets context for same-root descendants + the SSR-nested tree),
 * AND on the server records the value so the handle can emit one page-level marker every island seeds
 * from — closing the gap where a plain `setContext` shows up on the server but is gone on the client
 * (child islands are separate hydration roots). Only string keys bridge (they must serialize and be
 * read by `getContext('key')`); a symbol key is Svelte-only, same-root, no bridge.
 *
 * GRANULARITY: the optional third argument is the explicit marker — `{ islands: false }` keeps a key
 * host-native (same-root context works, nothing serializes). The default bridges: a missing key in an
 * island is a broken app, extra bytes are not. Ogygia never infers readership from `getContext` call
 * sites (aliased imports and wrapper modules would make any scan miss reads — the fatal direction).
 *
 * This is the FLAT page root: every island on the page inherits it. For scoped/shadowed context use
 * `<Provide>`, which wraps its subtree and beats the root on the same key.
 */
export declare function setContext<T>(key: unknown, value: T, opts?: SetContextOptions): T;
/**
 * Kept for ABI: the build still emits a registration call for each `createContext(...)` export (that
 * used to tag keyless handles by `module#export`). Keys are explicit now, so this is a no-op.
 */
export declare function __tag_context(): void;
