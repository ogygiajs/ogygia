/**
 * `flag()` — the ONE assignment primitive. A kill switch, a rollout, a targeting rule, and an
 * A/B/n test are the same thing: a name with variants, decided per visitor. This module owns the
 * DECISION only; branching rides `flag.pick()` (a router page slot, or a value map), measurement
 * rides the exposure sink, and vendor integration rides `decide({ source })`.
 *
 * Decision order per request (deterministic, sticky, ZERO-JS — it runs server-side during SSR and
 * the chosen variant is simply what gets rendered, so csr=false pages A/B for free):
 *   ?og-exp override (gated) → carried claims (a shell decided upstream) → the SOURCE
 *   (OpenFeature / OFREP / any resolver, primed once per request) → the native rule
 *   (targeting fn / weights) → the first variant (control / off).
 *
 * Everything the old surface split across `experiment` / `flag` / `layer` / `allowOverrides` /
 * `onExposure` / `batchExposures` / `.bucket` / `.on` / `.stamp` collapses to: `flag()`, calling
 * it, `.pick()`, `.value()`, and one `decide()`.
 */
import { BROWSER, DEV } from 'esm-env';
import { fnv1a32, type StandardSchemaV1 } from '@ogygia/core/plugin/utils';
import { flags_app } from './app.ts';
import { warn } from './messages.ts';
import { source_answered, source_failed, source_mark, source_reset } from './source-health.ts';
import {
	clock,
	defining,
	machine,
	outbox,
	policy,
	registry,
	say,
	scope,
	STALE,
	timers
} from '@ogygia/machine';

export type CtxLike = {
	request: Request;
	url: URL;
	cookies?: { get(name: string): string | undefined };
	/** The router's ONE identity (`routes(table, { visitor })`) — read first when present. Open
	 *  shape (matches the router's `Visitor`): a targeting fn reads app claims off it. */
	visitor?: (Record<string, unknown> & { sub?: string; vid?: string }) | undefined;
};

const BOOL_VARIANT: ReadonlyMap<unknown, string> = new Map([
	[true, 'on'],
	[false, 'off']
]);
/** Written by an upstream shell's identity hop (the fragment feature); absent = the tier is skipped. */
const CLAIMS = Symbol.for('ogygia.claims');
/** Per-request source resolution, cached on the Request (GC'd with it): its {@link Prime}. */
const RESOLVED = Symbol.for('ogygia.flags.resolved');

type Decision = { variant: string; value?: unknown };
/**
 * A request's source answer: `priming` while the source is asked (a second prime waits on `done`,
 * and a read meanwhile falls through to the native rule), then `resolved` with what it decided (an
 * empty map when the source decided nothing, or failed).
 */
type Prime =
	| { kind: 'priming'; done: Promise<void> }
	| { kind: 'resolved'; map: Record<string, Decision> };

const prime_of = (c: CtxLike) =>
	(c.request as unknown as Record<symbol, Prime | undefined>)[RESOLVED];
const set_prime = (c: CtxLike, p: Prime) =>
	((c.request as unknown as Record<symbol, Prime | undefined>)[RESOLVED] = p);

/** 0..9999 — sticky hash bucket for (salt, visitor). Uniform + deterministic, not cryptographic;
 *  the shared pure hash keeps this module safe in ANY bundle (runtime + every island entry). */
const pct = (s: string) => fnv1a32(s) % 10000;

type Visitor = NonNullable<CtxLike['visitor']>;

/** A signed-in visitor's `sub`, else a logged-out one's `vid`. */
const id_of = (v: Visitor | undefined) => v?.sub || v?.vid;

/** Who is this? The router identity (folds in carried claims) when present; raw claims / the
 *  `og-vid` cookie (the router's `anonymousVisitor()` shape, `{ vid, anonymous }`) otherwise;
 *  undefined = nobody. The ONE rule: a flag read hashes on its id (`sub`, else `vid`), and the
 *  source is primed with it as `c.visitor`. */
function visitor_of(c: CtxLike): Visitor | undefined {
	if (id_of(c.visitor)) return c.visitor;
	const claims = (c.request as unknown as Record<symbol, Visitor | undefined>)[CLAIMS];
	if (id_of(claims)) return claims;
	const vid = c.cookies?.get('og-vid');
	return vid ? { vid, anonymous: true } : c.visitor;
}

/** The sticky hash key. Nobody → '' (weights degrade to the first variant there). */
function visitor_id(c: CtxLike): string {
	return id_of(visitor_of(c)) ?? '';
}

function carried(c: CtxLike, name: string): string | undefined {
	const claims = (
		c.request as unknown as Record<symbol, { experiments?: Record<string, string> } | undefined>
	)[CLAIMS];
	return claims?.experiments?.[name];
}

// ── decide(): the ONE setup call ─────────────────────────────────────────────────────────────

/** One decided flag from the SOURCE: a variant name (validated against the flag's declared
 *  variants), optionally with a vendor-authored value (validated against the flag's `value`
 *  schema). A bare boolean/string is accepted too — sugar for `{ variant }`. */
export type Resolved = { variant: string; value?: unknown } | string | boolean;

/** What the source is asked to decide — the app's flags for this request. */
export interface FlagQuery {
	name: string;
	variants: readonly string[];
	/** `'boolean'` for a kill switch / rollout / targeting flag, `'variant'` for a weighted set. */
	kind: 'boolean' | 'variant';
}

/** A decision source — OpenFeature, OFREP, or any function. Given the app's flags + the request
 *  context, return each flag's decision (missing keys fall through to the native rule). Resolved
 *  ONCE per request (awaited by `handle()` / the router), so every read stays sync. */
export type FlagSource = (
	queries: FlagQuery[],
	c: CtxLike
) => Record<string, Resolved> | Promise<Record<string, Resolved>>;

export interface ExposureEvent {
	name: string;
	variant: string;
	/** the sticky identity the decision keyed on (undefined = anonymous) */
	sub?: string;
	at: number;
}

export interface DecideOptions {
	/** Where decisions come from (a vendor). Omit for pure-native flags (still sticky + zero-JS). */
	source?: FlagSource;
	/** Honor `?og-exp=name:variant` beyond dev — gate on something a visitor can't forge (a session
	 *  role, a signed QA cookie). Default: dev only. */
	overrides?: (c: CtxLike) => boolean;
	/** Exposure sink — called with a BATCH of events (batching is built in: flushed at `max`
	 *  events, after `ms`, or at each request's end). A throwing sink never breaks a request. */
	exposure?: (events: ExposureEvent[]) => void | Promise<void>;
	/** Exposure batch size / age caps. Defaults: `max` 25, `ms` 2000. */
	batch?: { max?: number; ms?: number };
}

let _source: FlagSource | null = null;
let _override_gate: (c: CtxLike) => boolean = () => DEV;
let _exposure: ((events: ExposureEvent[]) => void | Promise<void>) | null = null;
let _batch = { max: 25, ms: 2000 };

/**
 * Configure flags for this server, once (hooks.server.ts / any server module). Everything is
 * optional — with no `decide()` at all, flags are native, sticky, and zero-JS.
 *
 *   decide({ source: openfeature(client), overrides: (c) => !!c.visitor?.qa, exposure: send });
 */
export function decide(opts: DecideOptions): void {
	if ('source' in opts) {
		_source = opts.source ?? null;
		source_reset();
	}
	if (opts.overrides) _override_gate = opts.overrides;
	if ('exposure' in opts) _exposure = opts.exposure ?? null;
	if (opts.batch) _batch = { max: opts.batch.max ?? 25, ms: opts.batch.ms ?? 2000 };
}

// ── the exposure queue ───────────────────────────────────────────────────────────────────────

/**
 * THE EXPOSURE QUEUE (#243): a machine, idle (nothing waiting) or buffering (events waiting for the
 * size cap, the age cap or the request's end), and an outbox its batches go through. The outbox
 * sends one batch at a time, in the order they were made: events read during a send wait in the
 * queue and go in a batch of their own behind it. A sink that throws or rejects is tried again by
 * the exposure policy before the next batch goes, and one it never takes is said
 * (`flags_exposure_failed`, once per failing streak), never an unhandled rejection, which exits
 * Node by default.
 *
 * Server only: a browser bundle never sends exposures, and drops the queue.
 */
/** `buffering` holds what the next batch takes: the queue is its visit's, made with it and handed
 *  to the outbox when it ends. */
type QueueStates = { idle: {}; buffering: { queue: ExposureEvent[] } };
const queue_steps = { idle: ['buffering'], buffering: ['idle'] } as const;
const queue_def = /* @__PURE__ */ machine<QueueStates>()({
	name: 'flags exposures',
	initial: 'idle',
	steps: queue_steps
});
const _exposures = /* @__PURE__ */ queue_def.create();
/** A batch given up is said once per failing streak: the next is not said until one is taken. */
const _sink = /* @__PURE__ */ say({ max: 1 });
/** The last batch put, until it settles: the request's end waits for it (the outbox sends in
 *  order, so every batch before it has settled by then). */
let _last_sent: Promise<void> | null = null;

/** How a batch the sink failed is tried again: a pipeline restarting is ridden out, and the
 *  batches behind a sink that is down are not held long. */
const EXPOSURE_POLICY = /* @__PURE__ */ policy({
	attempts: 3,
	backoff: [250, 1000],
	jitter: 0.2,
	deadline: 10_000
});

/** The batches on their way to the sink: kept alive past the response, one at a time, in order. */
const _batches = /* @__PURE__ */ outbox<ExposureEvent[]>({
	name: 'flags exposures',
	send: async (batch) => {
		await _exposure?.(batch);
		_sink.ok('sink');
	},
	retry: EXPOSURE_POLICY,
	inOrder: true,
	giveUp: (_batch, error) => {
		_sink.once('sink', () => warn('flags_exposure_failed', error));
	},
	waitUntil: (work) => flags_app()?.keepAlive(work)
});

function emit_exposure(e: ExposureEvent): void {
	if (BROWSER || !_exposure) return;
	const now = _exposures.now;
	if (now.kind === 'buffering') {
		now.queue.push(e);
		if (now.queue.length >= _batch.max) void send(); // ok: send never rejects (a sink failure is said as flags_exposure_failed)
		return;
	}
	_exposures.go('buffering', { queue: [e] });
	if (_batch.max <= 1) {
		void send(); // ok: send never rejects
		return;
	}
	// the age cap, for this visit of `buffering` only: a send or a flush clears it
	// oxlint-disable-next-line ogygia/owned-effects -- the buffering visit's (its scope clears it, below), but a bare timer: it holds the process open until the queued exposures are sent, which a scope's timer does not
	const timer = timers.keep(() => void send(), _batch.ms); // ok: send never rejects
	_exposures.scope.defer(() => timers.cancel(timer));
}

/** Everything queued, as one batch into the outbox now (buffering → idle). Settles once the sink
 *  took it or it was given up; never rejects. */
function send(): Promise<void> {
	const now = _exposures.now;
	const batch = now.kind === 'buffering' ? now.queue : [];
	_exposures.move('buffering', 'idle');
	const sent = _batches.put(batch).then(() => {
		if (_last_sent === sent) _last_sent = null;
	});
	_last_sent = sent;
	return sent;
}

/**
 * Send the queued exposures to the sink now. Called at each request's end (the flags plugin's `done`)
 * and by the size and age caps. Resolves when they have reached the sink (behind the batches before
 * them); `undefined` when nothing is queued or being sent. A sink failure is contained: a lost batch
 * is never a request's problem.
 */
export function flush_exposures(): Promise<void> | undefined {
	if (_exposures.now.kind === 'buffering') return send();
	return _last_sent ?? undefined;
}

// ── registry + per-request source priming ────────────────────────────────────────────────────

/** Every constructed flag self-registers here — the complete name list a source is asked for, and
 *  the set federation auto-carries. Import your flags (route modules do this at startup; on plain
 *  Kit, `import './flags'` in hooks.server.ts to prime the source from the first request). */
const _registry = registry.keyed<string, Definition>();

/** A flag as defined: what a source is asked about, and the layer it is a member of. */
type Definition = { query: FlagQuery; layer: string | undefined };

/** Who owns a definition made outside a marked call (a build, or a test calling flag() itself):
 *  this module's run, as long as `_registry` beside it (a reload of this module makes both anew).
 *  In dev, core marks each flag() call with the run of the module making it (`b.definers()`), and
 *  that run owns it instead (`defining()`). */
const DEFINED_HERE = scope();

/**
 * Resolve the source ONCE per request over every registered flag, caching decisions on the
 * Request so reads stay sync. Awaited by the flags plugin's `request` stage (flags/server.ts), above
 * the page / hole split. Idempotent; a no-op without a source. Never throws — a source failure
 * degrades every flag to its native rule, it does not take the request down, and is said
 * (`flags_source_failed`, once per failing streak).
 */
export function prime_flags(c: CtxLike): Promise<void> {
	if (!_source) return Promise.resolve();
	const now = prime_of(c);
	if (now !== undefined) return now.kind === 'priming' ? now.done : Promise.resolve();
	if (_registry.size === 0) {
		set_prime(c, { kind: 'resolved', map: {} });
		return Promise.resolve();
	}
	// claimed before the source is asked: a second prime of this request waits on this one, and a
	// source that fails at once writes `resolved` over the claim, never under it (#374)
	const claim: { kind: 'priming'; done: Promise<void> } = {
		kind: 'priming',
		done: Promise.resolve()
	};
	set_prime(c, claim);
	claim.done = ask_source(c, _source);
	return claim.done;
}

/** How long a request waits for its flag source. The source primes above the page, so it gates the
 *  first byte: one that hangs falls to the native rule past this, and is said as a failure
 *  (test/source-failed.test.ts). */
const SOURCE_DEADLINE_MS = 1_000;

async function ask_source(c: CtxLike, source: NonNullable<typeof _source>): Promise<void> {
	const mark = source_mark();
	const asking = scope();
	asking.timeout(() => asking.close(), SOURCE_DEADLINE_MS);
	try {
		// the source sees the identity a read hashes on: it primes above the router, where no
		// `c.visitor` exists yet, so a vendor's per-user targeting would otherwise have no key
		const queries = [..._registry.values()].map((d) => d.query);
		const out = await asking.task(() => source(queries, { ...c, visitor: visitor_of(c) }));
		if (out === STALE)
			throw new DOMException(
				`the flag source did not answer within ${SOURCE_DEADLINE_MS} ms`,
				'TimeoutError'
			);
		const map: Record<string, Decision> = {};
		for (const q of queries) {
			const raw = out?.[q.name];
			if (raw === undefined) continue;
			let norm: Decision | null = typeof raw === 'object' ? raw : null;
			if (typeof raw === 'string') norm = { variant: raw };
			else if (typeof raw === 'boolean') norm = { variant: BOOL_VARIANT.get(raw)! };
			if (norm && q.variants.includes(norm.variant)) map[q.name] = norm;
		}
		set_prime(c, { kind: 'resolved', map });
		source_answered(mark);
	} catch (error) {
		set_prime(c, { kind: 'resolved', map: {} }); // source down → everything falls through to native
		source_failed(error);
	} finally {
		asking.close();
	}
}

function resolved_for(c: CtxLike, name: string): Decision | undefined {
	const p = prime_of(c);
	if (p === undefined && _source)
		// a source is configured but nothing primed this request: the plugin is not in the app's list,
		// so every read silently ignores the source. Say it once.
		_said.once('flags_source_unprimed', () => warn('flags_source_unprimed'));
	return p?.kind === 'resolved' ? p.map[name] : undefined;
}
/** The setup mistakes, each said once for the process. */
const _said = say({ max: 2 });

/** Record the decided variant as a request fact: federation carries the set as signed claims. */
function record_assigned(c: CtxLike, name: string, variant: string): void {
	const facts = flags_app()?.facts(c.request);
	if (facts) facts.assignments[name] = variant;
}

// ── override (?og-exp) ───────────────────────────────────────────────────────────────────────

function override(c: CtxLike, name: string): string | undefined {
	if (!_override_gate(c)) return undefined;
	for (const raw of c.url.searchParams.getAll('og-exp')) {
		for (const pair of raw.split(',')) {
			const [n, v] = pair.split(':');
			if (n === name && v) return v;
		}
	}
	return undefined;
}

// ── layers: mutual exclusion (a `layer: 'name'` string option) ───────────────────────────────

// (a layer's members are the flags defined now with that layer: the registry is the one table)
function layer_member_for(group: string, v: string): string | undefined {
	const members: string[] = [];
	for (const d of _registry.values()) if (d.layer === group) members.push(d.query.name);
	if (members.length === 0) return undefined;
	// Index into a SORTED view: registration order is module-import order, which can differ
	// between two server builds/replicas — lane assignment must depend only on (group, names,
	// visitor), never on which chunk loaded first.
	const lanes = [...members].sort();
	return lanes[pct(`layer:${group}:${v}`) % lanes.length];
}

// ── the primitive ────────────────────────────────────────────────────────────────────────────

/** A per-request component chooser for `page()` — `page(hero.pick({ control: A, bold: B }))`.
 *  Branded (not a bare function) because Svelte 5 components ARE functions. */
export interface ComponentPick {
	__ogpick: (c: CtxLike) => unknown;
}

/** Rare knobs (third arg to `flag`). */
export interface FlagOptions<Value = unknown> {
	/** Mutual-exclusion group. Members sharing a `layer` string split visitors into equal LANES:
	 *  one sticky hash of (group, visitor) over the sorted member names picks each visitor's
	 *  OWNER, and every other member answers control before its own rule runs — two experiments
	 *  on one surface never share a visitor, so their measurements stay attributable. Real
	 *  exposure = a member's split ÷ member count. Override/carried/source outrank the gate. */
	layer?: string;
	/** Standard Schema for a vendor-authored payload read via `.value(c)`. A vendor value that
	 *  fails the schema is IGNORED (never enters) — the same trust-boundary law as body schemas. */
	value?: StandardSchemaV1<Value>;
	/** Required alongside `value`: the payload when the source is silent or a value is invalid, so
	 *  `.value(c)` never returns undefined. */
	fallback?: Value;
}

/** The shape a flag is declared with (second arg):
 *  - omitted → a kill switch (off until decided on),
 *  - a number → sticky rollout percent (0–100) of the feature,
 *  - a function → per-request targeting (`true`/`false`, or `undefined` to fall through),
 *  - a record → weighted variants (ratios; the first key is control). */
export type FlagShape<V extends string> =
	| undefined
	| number
	| ((c: CtxLike) => boolean | undefined)
	| Record<V, number>;

interface FlagBase<Value> {
	readonly name: string;
	/** `name:variant` — for `data-og-exp` stamps, logs, Server-Timing labels. */
	stamp(c: CtxLike): string;
	/** Vendor-authored payload (validated by the `value` schema), else the `fallback`. */
	value(c: CtxLike): Value;
}

/** A boolean flag — calling it answers "does this request get the feature?". */
export interface BoolFlag<Value = unknown> extends FlagBase<Value> {
	(c: CtxLike): boolean;
	readonly variants: readonly ('off' | 'on')[];
	/** Page slot (no `c` — the router supplies it): `page(flag.pick({ … }))`. */
	pick(map: Record<'off' | 'on', unknown>): ComponentPick;
	/** Pick this visitor's entry from a per-variant map (`'off' | 'on'`), typed + total. */
	pick<T>(c: CtxLike, map: Record<'off' | 'on', T>): T;
}

/** A weighted-variant flag — calling it answers which variant this request gets. */
export interface VariantFlag<V extends string, Value = unknown> extends FlagBase<Value> {
	(c: CtxLike): V;
	readonly variants: readonly V[];
	/** Page slot (no `c` — the router supplies it): `page(flag.pick({ … }))`. */
	pick(map: Record<V, unknown>): ComponentPick;
	/** Pick this visitor's entry from a per-variant map, typed + total. */
	pick<T>(c: CtxLike, map: Record<V, T>): T;
}

// overloads: a record shape gives a VariantFlag<its keys>; everything else a BoolFlag.
export function flag<V extends string, Value = unknown>(
	name: string,
	shape: Record<V, number>,
	opts?: FlagOptions<Value>
): VariantFlag<V, Value>;
export function flag<Value = unknown>(
	name: string,
	shape?: number | ((c: CtxLike) => boolean | undefined),
	opts?: FlagOptions<Value>
): BoolFlag<Value>;
export function flag(
	name: string,
	shape?: FlagShape<string>,
	opts: FlagOptions = {}
): BoolFlag | VariantFlag<string> {
	const is_record = shape !== null && typeof shape === 'object';
	const variants: readonly string[] = is_record
		? (Object.keys(shape as Record<string, number>) as string[])
		: ['off', 'on'];
	const control = variants[0];
	const weights = is_record ? (shape as Record<string, number>) : null;
	const rollout = typeof shape === 'number' ? shape : null;
	const target =
		typeof shape === 'function' ? (shape as (c: CtxLike) => boolean | undefined) : null;

	_registry.set(
		name,
		{
			query: { name, variants, kind: is_record ? 'variant' : 'boolean' },
			layer: opts.layer || undefined
		},
		defining() ?? DEFINED_HERE
	);

	const memo = new WeakMap<Request, string>();

	const compute = (c: CtxLike): string => {
		const o = override(c, name);
		if (o && variants.includes(o)) return o;
		const carried_v = carried(c, name);
		if (carried_v && variants.includes(carried_v)) return carried_v;
		const src = resolved_for(c, name);
		if (src) return src.variant;
		const v = visitor_id(c);
		if (opts.layer && layer_member_for(opts.layer, v) !== name) return control;
		if (target) {
			const t = target(c);
			if (t !== undefined) return t ? 'on' : 'off';
		}
		if (weights && v) {
			const total = Object.values(weights).reduce((a, b) => a + (b > 0 ? b : 0), 0);
			if (total > 0) {
				const h = (pct(`${name}:${v}`) / 10000) * total;
				let floor = 0;
				for (const variant of variants) {
					const share = weights[variant] > 0 ? weights[variant] : 0;
					if (h >= floor && h < floor + share) return variant;
					floor += share;
				}
			}
		}
		if (rollout && v) {
			const share = rollout * 100; // percent → basis points
			if (pct(`${name}:${v}`) < share) return 'on';
		}
		return control;
	};

	const bucket = (c: CtxLike): string => {
		// every READ (fresh or memoized) is a per-visitor read: an A/B'd page must never be stored as
		// ONE variant for everyone, nor a cached hole kept as one (the render's read set, #434). Priming
		// deliberately does not report: it touches cookies on every request whether or not the page
		// reads a flag.
		const app = flags_app();
		if (app) app.perVisitor(c.request, `flag:${name}`);
		else if (!BROWSER) {
			// read on a server where the plugin never started: nothing reports the read, so a store
			// plugin could keep ONE variant of an A/B'd page for everyone. Say it once, loudly.
			_said.once('flags_plugin_not_running', () => warn('flags_plugin_not_running'));
		}
		const cached = memo.get(c.request);
		if (cached !== undefined) return cached;
		const variant = compute(c);
		memo.set(c.request, variant);
		record_assigned(c, name, variant);
		emit_exposure({ name, variant, sub: c.visitor?.sub, at: DEV ? 0 : now() });
		return variant;
	};

	const value = (c: CtxLike): unknown => {
		const raw = resolved_for(c, name)?.value;
		if (raw !== undefined && opts.value) {
			const r = opts.value['~standard'].validate(raw);
			// Standard Schema validate is sync for our purpose; a thenable or an issues[] → fall back.
			if (r && typeof (r as { then?: unknown }).then !== 'function') {
				const res = r as { value?: unknown; issues?: unknown };
				if (!res.issues) return res.value;
			}
		} else if (raw !== undefined && !opts.value) {
			return raw;
		}
		return opts.fallback;
	};

	const pick = (a: CtxLike | Record<string, unknown>, b?: Record<string, unknown>) => {
		if (b === undefined) {
			const map = a as Record<string, unknown>;
			return { __ogpick: (c: CtxLike) => map[bucket(c)] ?? map[control] };
		}
		return b[bucket(a as CtxLike)] ?? b[control];
	};

	const call = (c: CtxLike) => (is_record ? bucket(c) : bucket(c) === 'on');
	// A function's own `name`/`length` are read-only, so `defineProperties` (not `Object.assign`,
	// which throws on `name`) — and the flag's `name` shadows the function's.
	Object.defineProperties(call, {
		name: { value: name, enumerable: true },
		variants: { value: variants, enumerable: true },
		stamp: { value: (c: CtxLike) => `${name}:${bucket(c)}`, enumerable: true },
		value: { value, enumerable: true },
		pick: { value: pick, enumerable: true }
	});
	return call as unknown as BoolFlag | VariantFlag<string>;
}

/** `Date.now()` is unavailable in some sandboxes (workflow scripts); guard it so importing this
 *  module never throws there — exposure timestamps are 0 in that case (and in dev). */
function now(): number {
	try {
		return clock.wall(); // wall: an exposure's timestamp, sent to the analytics sink
	} catch {
		return 0; // ok: no clock in this sandbox: exposure timestamps are 0 (said above)
	}
}
