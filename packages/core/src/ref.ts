/**
 * THE HUB — ogygia's identity layer. One primitive carries everything that crosses an
 * island boundary:
 *
 *     Ref = { k: kind, i: identity, t: code tag, d: data }
 *
 * A held region, a portable snippet, a store, a `[og.wire]` class, a hoisted function —
 * each is a Ref of a different KIND. A kind teaches the hub how its values travel
 * (`match`/`encode`/`decode`); the hub owns everything identity:
 *
 *  - MINT: every live instance gets ONE id (WeakMap-memoized), however many props or
 *    context keys carry it — which is what lets the client reunite all copies.
 *  - RESOLVE: the browser memoizes decode by id (`remember: true`), so five islands
 *    decoding one handle share ONE live object. The server never memoizes
 *    (`remember: false`): each request decodes fresh — nothing leaks between users.
 *  - THE KEEP: a kind may name a ref for SESSION continuity (`keep_name`); the tab then
 *    reunites navigations with the same live instance, reconciling fresh server data via
 *    the kind's `merge`. Browser-only; the server never touches it.
 *
 * Everything interesting in the framework is an operation on `i`, not `d`: reunify across
 * islands = same id; survive a navigation = same id in the Keep; dedupe = same id; the
 * future region reconciler = diff two id sets. Kinds are plugins; identity is the spine.
 *
 * All registry state lives on `globalThis` under `Symbol.for` keys — the runtime and each
 * island entry are separate bundles, and per-module state would silently fork.
 */

/** The wire shape. `k` picks the kind, `i` is identity, `t` names code (module tag /
 *  chunk / factory), `d` is devalue-safe data (value, snapshot, props, bound captures). */
export interface Ref {
	k: string;
	i: string;
	t?: string;
	d?: unknown;
	/** Scope hint (hub v2, phase S) — which lifetime bucket governs this instance:
	 *  'request' (server, never memoized) | 'page' (this render) | 'session' (cross-nav, tab).
	 *  Optional on the wire; when absent, resolve derives it (keep_name ⇒ session, else the
	 *  caller's page/request choice). Present so a scope can be DISPOSED as a unit (phase D). */
	sc?: Scope;
}

/** The three identity lifetimes, one axis of the hub's policy space. */
export type Scope = 'request' | 'page' | 'session';

/** A kind teaches the hub one family of transportable values. */
export interface RefKind {
	/** Kind discriminator carried in `Ref.k` ('wire' | 'store' | 'snippet' | 'region' | 'fn' | …). */
	k: string;
	/** Claim a live value (mint dispatch, first registered wins). */
	match(value: unknown): boolean;
	/** Sending side: code tag + devalue-safe data. */
	encode(value: object): { t?: string; d?: unknown };
	/** Receiving side: rebuild a live value from the ref. */
	decode(ref: Ref): unknown;
	/** An id DERIVED from the descriptor, for a kind whose decode reads only `d` and whose instances
	 *  hold no state: equal descriptors ARE the same value, so they may share the id — and a render
	 *  mints the same id every time (the HTML, the island's fingerprint and every cache keyed on them
	 *  stay put across requests). `undefined` (or no hook) → a fresh random id, as every stateful kind
	 *  needs (a store, a class instance: identity is the point). */
	stable_id?(d: unknown): string | undefined;
	/** SESSION continuity: name this ref to promote its instance to tab lifetime (browser only). */
	keep_name?(ref: Ref): string | undefined;
	/** Reconcile a kept live instance with a freshly arrived ref (default: kept wins untouched). */
	merge?(kept: object, ref: Ref): void;
	/** Tear down a live instance when a navigation releases it (nothing on the next page owns it)
	 *  — close a channel, abort a fetch, drop a subscription. Most kinds have nothing to release (GC
	 *  handles the object); implement only when the instance owns a resource beyond memory. */
	dispose?(live: object): void;
}

interface HubRegistry {
	/** kind discriminator → kind (decode dispatch). */
	kinds: Map<string, RefKind>;
	/** mint dispatch order (registration order; first match wins). */
	order: RefKind[];
	/** live instance → minted id (one id per instance, however many carriers). */
	ids: WeakMap<object, string>;
	/** THE SCOPED STORE — scope → (key → live instance): the 'page' bucket keyed by ref.i, the
	 *  'session' bucket keyed by continuity name. 'request' is never populated — the server decodes
	 *  fresh. Browser tab only. */
	instances: Map<Scope, Map<string, object>>;
	/** live instance → its kind discriminator, so a release can dispatch `kind.dispose` without
	 *  storing the kind inline in every bucket entry. Weak — never pins an instance. */
	instance_kind: WeakMap<object, string>;
	/** continuity name → owning code tag (collision guard: one name, one kind of thing). */
	keep_owner: Map<string, string>;
	/** The names of the render minting now (the server's request; `null` on the client and off a
	 *  request). Installed by hooks.ts. */
	names: (() => RefNames | null) | null;
}

/**
 * THE NAMES OF ONE RENDER. A stateful ref's id has two parts: the render's FENCE, random and the
 * same for every ref one server request mints, and its PLACE, the order the request first minted
 * that instance in. The fence keeps two answers that land in one tab (a page and a hole, a stored
 * page and the holes stitched into it) from ever sharing an id; the place is what stays the same
 * from one render of a page to the next, so identity across renders (an island's fingerprint, and
 * everything keyed on it) reads the place alone ({@link placed}). One instance gets one name per
 * request, however many props or context keys carry it.
 */
export interface RefNames {
	/** live instance → its name in this render */
	readonly ids: WeakMap<object, string>;
	/** the render's fence: the head of every name it mints */
	readonly fence: string;
	/** the next place */
	next: number;
}

/** A fresh render's names. */
export function ref_names(): RefNames {
	return { ids: new WeakMap(), fence: mint_id().replaceAll('-', '').slice(0, 16), next: 0 };
}

/** Install the reader of the render minting now (hooks.ts: one {@link RefNames} per request). */
export function set_ref_names_reader(fn: (() => RefNames | null) | null): void {
	registry().names = fn;
}

/**
 * Run `fn` minting with LOCAL names: no fence, places counted from 0 in the order `fn` first mints
 * each instance. What `fn` writes then names its refs the same way in any render, on either leg
 * (a hole's identity, server/props-wire.ts `hole_identity`). The render's own names come back after.
 */
export function with_local_names<T>(fn: () => T): T {
	const reg = registry();
	const outer = reg.names;
	const local: RefNames = { ids: new WeakMap(), fence: '', next: 0 };
	reg.names = () => local;
	try {
		return fn();
	} finally {
		reg.names = outer;
	}
}

/**
 * `text` with the minting render's ref ids in place form, fence dropped: what a render of the same
 * thing writes every time. Text from a render with no names (the client, off a request) is
 * returned as it is.
 */
export function placed(text: string): string {
	const fence = registry().names?.()?.fence;
	return fence !== undefined && text.includes(fence) ? text.replaceAll(fence, '') : text;
}

import { random } from '@ogygia/machine';
import { emit as dt_emit } from './events/bus.ts';
import { batch, notify, watchers } from './ref-watch.ts';
import { resolve_sink } from './ref-sink.ts';
import { OgygiaError } from './messages/island.ts';
import { report_thrown } from './report-thrown.ts';

// DEVTOOLS gate — module-local const from the Vite `define` (proven DCE pattern); off → folds out.
const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

const REGISTRY_KEY = Symbol.for('ogygia.hub');

function registry(): HubRegistry {
	const g = globalThis as Record<symbol, unknown>;
	return ((g[REGISTRY_KEY] as HubRegistry | undefined) ??= {
		kinds: new Map(),
		order: [],
		ids: new WeakMap(),
		instances: new Map([
			['page', new Map()],
			['session', new Map()]
		]),
		instance_kind: new WeakMap(),
		keep_owner: new Map(),
		names: null
	});
}

/** Register a kind. Idempotent by discriminator — a re-registration (second bundle evaluating
 *  the same module) keeps the FIRST, so identity state never forks. */
export function register_kind(kind: RefKind): void {
	const reg = registry();
	if (reg.kinds.has(kind.k)) return;
	reg.kinds.set(kind.k, kind);
	reg.order.push(kind);
}

function mint_id(): string {
	return random.uuid();
}

/**
 * Mint: live value → Ref, or undefined to fall through to devalue's normal handling.
 * `only` restricts the dispatch to named kinds — a seam may deliberately exclude a family
 * (the drop-in context path excludes snippets so a stray function THROWS instead of being
 * silently mis-read as one). Same instance → same id, for the whole render (a server request) or
 * the tab (the client).
 */
export function mint(value: unknown, only?: ReadonlySet<string>): Ref | undefined {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
		return undefined;
	const reg = registry();
	for (const kind of reg.order) {
		if (only && !only.has(kind.k)) continue;
		if (!kind.match(value)) continue;
		const { t, d } = kind.encode(value as object);
		// (a server request names its instances itself: fence + place, see RefNames)
		const names = reg.names?.() ?? null;
		const ids = names === null ? reg.ids : names.ids;
		let i = ids.get(value as object);
		if (i === undefined) {
			// (a stateless kind names it by its content: the same on every render)
			i =
				kind.stable_id?.(d) ??
				(names === null ? mint_id() : `${names.fence}~${(names.next++).toString(36)}`);
			ids.set(value as object, i);
		}
		const ref: Ref = { k: kind.k, i, d };
		if (t !== undefined) ref.t = t;
		if (DEVTOOLS) dt_emit({ domain: 'hub', name: 'hub.mint', kind: kind.k, id: i, tag: t });
		return ref;
	}
	return undefined;
}

// The RESOLVE SINK (reconciler R3) lives in a leaf: ref-sink.ts says what it is and why.
export { set_resolve_sink } from './ref-sink.ts';

/** The live bucket for a scope (never 'request' — that scope is never stored). */
function bucket(reg: HubRegistry, scope: Scope): Map<string, object> {
	let b = reg.instances.get(scope);
	if (b === undefined) reg.instances.set(scope, (b = new Map()));
	return b;
}

/** Memoize an instance in a scope's bucket, recording its kind for its release. The 'page'
 *  bucket is bounded by its owners: a navigation releases every id nothing on the next page owns
 *  (runtime/reconcile.ts `release_page_ids`). */
function remember_in(
	reg: HubRegistry,
	scope: Scope,
	key: string,
	instance: object,
	kind_k: string
): void {
	bucket(reg, scope).set(key, instance);
	reg.instance_kind.set(instance, kind_k);
	if (scope === 'page' && resolve_sink !== null) resolve_sink(key);
}

/** The ids the 'page' bucket holds now: what a navigation weighs for release. */
export function page_ids(): string[] {
	return Array.from(bucket(registry(), 'page').keys());
}

/**
 * Release page-scoped ids (a navigation's, runtime/reconcile.ts `release_page_ids`): each id's
 * instance is torn down via its kind.dispose and leaves the page bucket — UNLESS it is also
 * session-aliased (continuity): then only its page alias goes, and the session bucket keeps it.
 * Ids not in the page bucket are skipped.
 */
export function dispose_ids(ids: Iterable<string>): void {
	const reg = registry();
	const page = bucket(reg, 'page');
	const survivors = new Set<object>(bucket(reg, 'session').values());
	let dt_disposed = 0;
	for (const id of ids) {
		const inst = page.get(id);
		if (inst === undefined) continue;
		page.delete(id);
		if (DEVTOOLS) dt_disposed++;
		if (survivors.has(inst)) continue; // session-aliased — its resources outlive the nav
		const kind = reg.kinds.get(reg.instance_kind.get(inst) ?? '');
		reg.instance_kind.delete(inst);
		try {
			kind?.dispose?.(inst);
		} catch (error) {
			// (one instance's teardown throwing must not strand the rest, and is not dropped)
			report_thrown(error);
		}
	}
	if (DEVTOOLS && dt_disposed > 0)
		dt_emit({ domain: 'hub', name: 'hub.dispose', scope: 'ids', count: dt_disposed });
}

/**
 * Resolve: Ref → live value.
 *
 * Second arg is a {@link Scope} (or a legacy boolean shim: `true` ⇒ 'page', `false` ⇒ 'request').
 * 'page'/'session' (browser) memoize by id — decoding the same ref twice returns the SAME instance
 * (the liveness mechanism), and a kind-named ref reunites with the session bucket across
 * navigations (the kind's `merge` reconciles fresh server data in; default kept-wins). 'request'
 * (server, defer/streaming renders) always decodes fresh: memoizing across requests would leak one
 * user's state into another's HTML.
 */
export function resolve(ref: Ref, scope_or_remember: boolean | Scope): unknown {
	let scope = scope_or_remember;
	if (scope === true) scope = 'page';
	else if (scope === false) scope = 'request';
	const remember = scope !== 'request';
	const reg = registry();
	if (remember) {
		const existing = bucket(reg, 'page').get(ref.i);
		if (existing !== undefined) {
			// (a reunion is a resolve like any other: whoever decodes the id owns it too)
			if (resolve_sink !== null) resolve_sink(ref.i);
			// WATCH path (hub v2, phase W): a re-resolve of a WATCHED id carrying fresh data folds
			// that data into the live instance (via the kind's merge) and notifies watchers — the
			// reactive graph resumes in place. With no watchers this is byte-for-byte the old
			// early-return, so reunification-by-identity (stores, snippets) is untouched.
			const w = watchers().get(ref.i);
			if (w !== undefined && w.size > 0) {
				const kind = reg.kinds.get(ref.k);
				if (kind?.merge !== undefined) {
					kind.merge(existing, ref);
					notify(ref.i, existing);
				}
			}
			if (DEVTOOLS)
				dt_emit({
					domain: 'hub',
					name: 'hub.resolve',
					kind: ref.k,
					id: ref.i,
					scope,
					tag: ref.t,
					hit: true
				});
			return existing;
		}
	}
	const kind = reg.kinds.get(ref.k);
	if (kind === undefined) {
		throw new OgygiaError('ref_kind_missing', { kind: String(ref.k) });
	}

	if (remember) {
		const name = kind.keep_name?.(ref);
		if (typeof name === 'string') {
			// Collision guard: two different code tags claiming one continuity name would silently
			// reuse each other's instance. Warn (dev) — a continuity name must be unique per thing.
			const tag = ref.t ?? ref.k;
			const owner = reg.keep_owner.get(name);
			if (owner === undefined) reg.keep_owner.set(name, tag);
			else if (owner !== tag && typeof console !== 'undefined') {
				console.error(new OgygiaError('continuity_id_collision', { name, owner, tag }));
			}
			const kept = bucket(reg, 'session').get(name);
			if (kept !== undefined) {
				kind.merge?.(kept, ref);
				// The session bucket is the source of truth for the name; this ref's id aliases it in
				// the page bucket too, so late-hydrating islands on the same page reunite with it.
				remember_in(reg, 'page', ref.i, kept, ref.k);
				if (DEVTOOLS)
					dt_emit({
						domain: 'hub',
						name: 'hub.resolve',
						kind: ref.k,
						id: ref.i,
						scope,
						tag: ref.t,
						hit: true
					});
				return kept;
			}
			const instance = kind.decode(ref);
			if (instance !== null && typeof instance === 'object') {
				remember_in(reg, 'session', name, instance as object, ref.k);
				remember_in(reg, 'page', ref.i, instance as object, ref.k);
			}
			if (DEVTOOLS)
				dt_emit({
					domain: 'hub',
					name: 'hub.resolve',
					kind: ref.k,
					id: ref.i,
					scope,
					tag: ref.t,
					hit: false
				});
			return instance;
		}
	}

	const instance = kind.decode(ref);
	if (remember && instance !== null && typeof instance === 'object') {
		remember_in(reg, 'page', ref.i, instance as object, ref.k);
	}
	if (DEVTOOLS)
		dt_emit({
			domain: 'hub',
			name: 'hub.resolve',
			kind: ref.k,
			id: ref.i,
			scope,
			tag: ref.t,
			hit: false
		});
	return instance;
}

// WATCH / NOTIFY / BATCH live in ref-watch.ts (the boot needs only them, never the whole hub);
// re-exported here so the hub stays the one import for everything identity.
export { watch, notify, batch, watcher_count } from './ref-watch.ts';

/** Resolve a bag of refs as one transaction (sugar over {@link batch}). */
export function resolve_batch(refs: readonly Ref[], scope: boolean | Scope): unknown[] {
	return batch(() => refs.map((r) => resolve(r, scope)));
}

export { REF_WIRE_KEY } from './ref-key.ts';

/** Devalue reducer for a seam. `only` deliberately restricts which families may cross there. */
export function ref_reducer(only?: ReadonlySet<string>): (value: unknown) => Ref | undefined {
	return (value) => mint(value, only);
}

/** Devalue reviver for a seam. Browser passes `remember: true`; the server must pass `false`. */
export function ref_reviver(remember: boolean): (ref: Ref) => unknown {
	return (ref) => resolve(ref, remember);
}
