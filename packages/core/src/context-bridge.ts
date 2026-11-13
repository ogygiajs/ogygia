/**
 * Cross-island context — one bridge, plain `getContext`.
 *
 * Component trees break at every island boundary; the DOM tree does not. A `<Provide values={…}>`
 * writes its values into the DOM (serialized with the SAME codec as island props), and ogygia seeds
 * each island's `hydrate({ context })` from the providers above it — so a child island's own
 * `getContext('key')`, unchanged, reads a (csr=false) layout's context across the island-root split.
 * A `[ogygia.wire]` value resolves to the one live instance (shared + reactive); a plain value is a
 * per-consumer snapshot.
 */
import { getContext, hasContext, setContext as svelte_set_context } from 'svelte';
import { parse, stringify } from 'devalue';
import { DEV } from 'esm-env';
import { REF_WIRE_KEY, ref_reducer, ref_reviver, batch } from './ref.ts';
// PULL-registration: kinds register inside the seam functions below (idempotent, tree-shake-proof,
// and the modules stay free of import-time side effects).
import { register_wire_kind } from './live-transport.ts';
import { register_store_kind, register_derived_kind } from './store-transport.ts';
import { register_snippet_kind } from './region-snippet.ts';
import { register_fn_kind } from './fn-transport.ts';

function ensure_ctx_kinds(): void {
	register_wire_kind();
	register_store_kind();
	register_snippet_kind();
	register_fn_kind();
	register_derived_kind();
}
import { boundary_problems } from './boundary.ts';
import { record_ctx, type SetContextOptions } from './context-registry.ts';
import { key_label, key_name, key_of } from './contract/context-key.ts';
import { boot_link } from './runtime/slots.ts';
import { OGYGIA_PROVIDE, OGYGIA_PROVIDE_PAGE } from './wire-markup.ts';
import { escape_script_text } from './escape.ts';
import { OgygiaError, warn } from './messages/island.ts';

/** The `<Provide>` seam carries classes, stores AND snippets (a snippet freezes/travels live). */
// static: the value families a provided context carries
const PROVIDE_FAMILIES = new Set(['wire', 'store', 'snippet', 'fn', 'derived']);
/** The drop-in page-marker seam deliberately EXCLUDES snippets: there, a bare function must
 *  THROW (and be dropped with a dev explanation) rather than be silently frozen as one. */
// static: the value families the bridge carries
const BRIDGE_FAMILIES = new Set(['wire', 'store', 'fn', 'derived']);

/** A provider's values keyed by the names they cross under; a key that cannot cross is left out
 *  (and said in dev). */
export function crossing_values(values: object): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of Reflect.ownKeys(values)) {
		const name = key_name(key);
		if (name !== null) out[name] = (values as Record<PropertyKey, unknown>)[key];
		else if (DEV) warn('context_key_one_off', { key: key_label(key) });
	}
	return out;
}

/** Serialize a `<Provide>`'s values for the DOM — same codec as island props (one hub key). */
export function serialize_context(values: object): string {
	ensure_ctx_kinds();
	return escape_script_text(
		stringify(crossing_values(values), { [REF_WIRE_KEY]: ref_reducer(PROVIDE_FAMILIES) })
	);
}

/**
 * Serialize for the drop-in `setContext` page marker WITHOUT the region-snippet reducer. That reducer
 * treats every function as a snippet (snippets are unbranded functions), which would silently turn a
 * `setContext('trackPageView', fn)` — or a class method — into a bogus snippet instead of failing.
 * Here a function must THROW so the offending value gets dropped (see below). Transportables
 * (`[ogygia.wire]`) and stores (auto-wired: value crosses, islands reunite to one live instance)
 * cross. A snippet in context is a `<Provide>` concern, not this drop-in path.
 */
function stringify_bridgeable(value: unknown): string {
	ensure_ctx_kinds();
	return escape_script_text(stringify(value, { [REF_WIRE_KEY]: ref_reducer(BRIDGE_FAMILIES) }));
}

/**
 * Serialize the drop-in `setContext` page-root bag for the DOM marker. A layout may `setContext` a
 * FUNCTION (e.g. `trackPageView`) or a DOM-holding object — values that genuinely can't cross an
 * island boundary. Rather than crash the page (or bridge a broken value), drop the offenders
 * key-by-key and bridge the rest; in DEV each drop is explained by the boundary classifier (key +
 * path + what to do), so a missing context inside an island is never a mystery. Returns null if
 * nothing serializable remains. The happy path (all serializable) is a single `stringify`.
 */
/** DEV threshold for the page-marker payload — islands ship context into every page's HTML. */
const CTX_SIZE_WARN_BYTES = 32 * 1024;

export function serialize_provided_context(map: Map<string, unknown>): string | null {
	const obj: Record<string, unknown> = {};
	for (const [k, v] of map) obj[k] = v;
	try {
		const payload = stringify_bridgeable(obj);
		if (DEV && payload.length > CTX_SIZE_WARN_BYTES) warn_ctx_size(map, payload.length);
		return payload;
	} catch {
		const safe: Record<string, unknown> = {};
		for (const k in obj) {
			try {
				stringify_bridgeable({ [k]: obj[k] });
				safe[k] = obj[k];
				if (DEV) warn_boundary(k, obj[k], false);
			} catch {
				// Can't bridge (function / DOM / unwired class) — native setContext still served the
				// same-root tree; islands won't see this key. In DEV, say exactly why.
				if (DEV) warn_boundary(k, obj[k], true);
			}
		}
		return Object.keys(safe).length ? stringify_bridgeable(safe) : null;
	}
}

/** DEV: the page marker is heavy — name the biggest keys so the fix is obvious (mark them
 *  { islands: false }, or slim the value). Sizes are per-key serialized lengths. */
function warn_ctx_size(map: Map<string, unknown>, total: number): void {
	const sizes: Array<[string, number]> = [];
	for (const [k, v] of map) {
		try {
			sizes.push([k, stringify_bridgeable({ [k]: v }).length]);
		} catch {
			// ok: an unbridgeable key is dropped (and said) where the bridge is written
		}
	}
	sizes.sort((a, b) => b[1] - a[1]);
	const top = sizes
		.slice(0, 3)
		.map(([k, n]) => `${key_label(key_of(k))} ~${(n / 1024).toFixed(1)}kB`)
		.join(', ');
	warn('context_marker_large', { size: (total / 1024).toFixed(1), top });
}

/** DEV: explain a dropped (or degraded-but-bridged) context key via the classifier. */
function warn_boundary(name: string, value: unknown, dropped: boolean): void {
	const key = key_label(key_of(name));
	const problems = boundary_problems(value, key);
	if (dropped && problems.length === 0) {
		warn('context_dropped', { key });
		return;
	}
	for (const f of problems) {
		if (dropped || f.kind === 'warn')
			warn('context_unserializable', { key, path: f.path || undefined, detail: f.detail });
	}
}

/** Decode one serialized provider payload; a corrupt payload yields nothing (never breaks hydration). */
function parse_ctx(text: string | null | undefined): Record<string, unknown> | undefined {
	if (!text) return undefined;
	ensure_ctx_kinds();
	try {
		// decode is universal: whatever kind arrives, the hub resolves it (browser → remember).
		// BATCH (phase B): a page's context keys often reference each other's instances (a derived
		// over a store, a wire holding a store) — resolve them as ONE transaction so no watcher
		// reacts to a half-decoded graph.
		return batch(() =>
			parse(text, { [REF_WIRE_KEY]: ref_reviver(true) } as Parameters<typeof parse>[1])
		) as Record<string, unknown>;
	} catch (e) {
		if (DEV) warn('page_payload_unreadable', { what: 'context marker' }, e);
		return undefined;
	}
}

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
export function collect_provided_context(
	start: Element | null
): Map<string | symbol, unknown> | undefined {
	let el: Element | null = start;
	let map: Map<string | symbol, unknown> | undefined;
	const fold = (values: Record<string, unknown> | undefined) => {
		if (!values) return;
		map ??= new Map();
		// Nearest wins: the scoped walk sees the closest provider FIRST, and the page root LAST.
		for (const name in values) {
			const key = key_of(name);
			if (!map.has(key)) map.set(key, values[name]);
		}
	};
	while (el) {
		if (el.tagName === 'OGYGIA-PROVIDE') {
			fold(parse_ctx(el.querySelector(`:scope > script[${OGYGIA_PROVIDE}]`)?.textContent));
		}
		el = el.parentElement;
	}
	// Page-level root from the drop-in `setContext` (emitted once by the handle before `</body>`).
	if (typeof document !== 'undefined') fold(page_ctx());
	return map;
}

/** The page's context root, found and parsed ONCE per document (every island's hydrate asks; a
 *  search of the whole DOM each time grew with the page). A router swap brings the next page's. */
let page_ctx_cache: { value: Record<string, unknown> | undefined } | null = null;
let page_ctx_reset = false;
function page_ctx(): Record<string, unknown> | undefined {
	if (!page_ctx_reset) {
		page_ctx_reset = true;
		// oxlint-disable-next-line ogygia/owned-effects -- the page context cache's reset on each page swap, installed once (`page_ctx_reset`): it lives as long as the document
		document.addEventListener('og:after-swap', () => (page_ctx_cache = null));
	}
	return (page_ctx_cache ??= {
		// (the runtime's reader: a page root is the server's only with its response's mark)
		value: parse_ctx(
			boot_link().server_channel(document, `script[${OGYGIA_PROVIDE_PAGE}]`)?.textContent
		)
	}).value;
}

/**
 * What `createContext(name)` returns: Svelte's `[get, set, has]`, keyed by `Symbol.for(name)`, so a
 * value set above reaches every region in the browser too.
 */
export type Context<T> = readonly [get: () => T, set: (value: T) => T, has: () => boolean];

/**
 * A typed context, in Svelte's `createContext` shape: `[get, set, has]`. Its key is
 * `Symbol.for(name)`, so it crosses into regions (each wakes as its own root in the browser) and is the
 * same key as a plain `setContext(Symbol.for(name), …)`. The setter is `setContext` from `ogygia`, so
 * a value set in a csr=false layout reaches every region on the page. `get` throws when nothing above
 * set it, like Svelte's; `has` asks first.
 *
 * ```ts
 * import { createContext } from 'ogygia';
 * export const [getRuntime, setRuntime] = createContext<AppRuntime>('app-runtime');
 * // in a layout:  setRuntime(runtime);
 * // in a region:  const runtime = getRuntime();
 * ```
 *
 * A value with methods crosses as a wired class (`static wire = import.meta.og.wire(…)`): every
 * region gets the one live instance.
 */
export function createContext<T>(name: string): Context<T> {
	const key = Symbol.for(name);
	const has = (): boolean => hasContext(key);
	const get = (): T => {
		if (!hasContext(key)) throw new OgygiaError('context_missing', { key: key_label(key) });
		return getContext<T>(key);
	};
	const set = (value: T): T => setContext(key, value);
	return [get, set, has];
}

/**
 * Drop-in `setContext` — swap `import { setContext } from 'svelte'` for `from 'ogygia'` and an
 * existing csr=false layout's context reaches child islands with NO other change.
 *
 * It does exactly what Svelte's does (sets context for same-root descendants + the SSR-nested tree),
 * AND on the server records the value so the handle can emit one page-level marker every island seeds
 * from — closing the gap where a plain `setContext` shows up on the server but is gone on the client
 * (child islands are separate hydration roots). A string key and a shared `Symbol.for(name)` key
 * bridge; a one-off `Symbol()` key has no twin in the browser and stays same-root.
 *
 * GRANULARITY: the optional third argument is the explicit marker — `{ islands: false }` keeps a key
 * host-native (same-root context works, nothing serializes). The default bridges: a missing key in an
 * island is a broken app, extra bytes are not. Ogygia never infers readership from `getContext` call
 * sites (aliased imports and wrapper modules would make any scan miss reads — the fatal direction).
 *
 * This is the FLAT page root: every island on the page inherits it. For scoped/shadowed context use
 * `<Provide>`, which wraps its subtree and beats the root on the same key.
 */
export function setContext<T>(key: unknown, value: T, opts?: SetContextOptions): T {
	record_ctx(key, value, opts);
	return svelte_set_context(key, value);
}

/**
 * Kept for ABI: the build still emits a registration call for each `createContext(...)` export (that
 * used to tag keyless handles by `module#export`). Keys are explicit now, so this is a no-op.
 */
export function __tag_context(): void {}
