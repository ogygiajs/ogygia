/**
 * The simulated implementation of the ports (packages/machine/src/ports.ts): one per realm (a tab or
 * a server instance), all on the run's loop. The ports read their realm's platform when called, so
 * installing these on a realm (`install`) makes ogygia's calls, and Svelte's and Kit's beside them,
 * play the seed.
 *
 * - Time: `Date.now()` is the run's epoch plus virtual time plus the realm's skew (a server's clock
 *   may be off by seconds); `performance.now()` is virtual time since the realm was born, so it never
 *   steps. A document's `performance` is its own (./timeline.ts); the host keeps Node's.
 * - Timers, frames (every 16 ms, aligned per realm) and idle callbacks (a quiet moment the seed
 *   picks, with a `timeRemaining` that runs down) are loop tasks of the realm.
 * - Randomness and crypto bytes come from the realm's own stream.
 * - `fetch`, `EventSource`, `IntersectionObserver` and storage are given by the world (the network,
 *   the tab's viewport, the tab's origin storage): `install` takes them.
 */
import { AsyncResource } from 'node:async_hooks';
import type { Platform } from '@ogygia/machine';
import type { Loop, Task } from './loop.ts';
import type { Rng } from './rng.ts';

/** The run's wall-clock epoch: a fixed date, so every run's timestamps are the same. */
export const EPOCH = Date.UTC(2026, 0, 1);

const FRAME_MS = 16;

/** The host's own `WeakRef` and `FinalizationRegistry`, before any realm's platform replaces them. */
const HOST_WEAK_REF = globalThis.WeakRef;
const HOST_FINALIZATION_REGISTRY = globalThis.FinalizationRegistry;

/** `SIM_SITES=1`: each timer's trace line names the code that set it (to find a replay leak). */
export const SITES = process.env.SIM_SITES === '1';

/** The first caller outside the simulator, as `file:line` (its path after the last `/`). */
export function site(): string {
	const lines = (new Error().stack ?? '').split('\n').slice(1);
	const at = lines.find((l) => !l.includes('/internal/sim/src/')) ?? '';
	return at
		.trim()
		.replace(/^at /, '')
		.replace(/\(?[^\s(]*\/([^/]+:\d+):\d+\)?$/, '$1');
}

export interface RealmOptions {
	/** The realm's name in the loop and the trace (`tab-1`, `server-0`). */
	name: string;
	loop: Loop;
	rng: Rng;
	/** ms this realm's wall clock is ahead (negative: behind); read at each call when a function
	 *  (the host realm reads the skew of the server instance whose request is running). */
	skew?: number | (() => number);
	/** When the realm's clock starts (`performance.now()` and frame times count from it); none: now.
	 *  A document's starts with its navigation, before the realm is made (as a browser's
	 *  `timeOrigin`). */
	born?: number;
	/** Hand out Node-shaped timer handles (the host realm, where the servers run). */
	node?: boolean;
	/** Whether this realm takes the rare branch `point` now (the world's buggify swarm); none: never. */
	buggify?: (realm: string, point: string) => boolean;
	/** Whether the realm's tab is hidden now: its animation frames wait until `shown()`, as a
	 *  browser runs none in a background tab. None: always shown. */
	hidden?: () => boolean;
}

export interface SimPlatform extends Platform {
	/** The realm's name. */
	readonly realm: string;
	/** Its tab is shown again: the animation frames asked for while it was hidden come at the next
	 *  frame. */
	readonly shown: () => void;
	/** Timers and callbacks set and not yet run or cleared. */
	readonly outstanding: () => number;
	/** Their trace labels (with `SIM_SITES=1`, each names the code that set it). */
	readonly pending: () => string[];
	/** Its world is over: the realm lets go of the world's loop and options. */
	readonly end: () => void;
}

/**
 * A realm's hold on its world: the world's loop and the realm's options until the world ends, then
 * none. What a world leaves behind in the process (a server's modules stay loaded, and keep its
 * timer handles and its clock) then never keeps the world itself (test/weak-refs.test.ts). Once
 * ended, the realm's clock stands still and its timers are never due, as they were never run before.
 */
class WorldTie {
	#loop: Loop | null;
	#options: RealmOptions | null;
	#ended_at = 0;

	constructor(loop: Loop, options: RealmOptions) {
		this.#loop = loop;
		this.#options = options;
	}

	get now(): number {
		return this.#loop?.now ?? this.#ended_at;
	}

	get options(): RealmOptions | null {
		return this.#options;
	}

	add(realm: string, label: string, ms: number, run: () => void): Task | null {
		return this.#loop?.add(realm, label, ms, run) ?? null;
	}

	end(): void {
		this.#ended_at = this.now;
		this.#loop = null;
		this.#options = null;
	}
}

/** The simulated time, timers, task hooks and randomness of one realm. */
export function platform(
	options: RealmOptions
): Pick<
	SimPlatform,
	| 'realm'
	| 'shown'
	| 'outstanding'
	| 'pending'
	| 'setTimeout'
	| 'clearTimeout'
	| 'setInterval'
	| 'clearInterval'
	| 'queueMicrotask'
	| 'requestAnimationFrame'
	| 'cancelAnimationFrame'
	| 'requestIdleCallback'
	| 'cancelIdleCallback'
	| 'performance'
	| 'Date'
	| 'Math'
	| 'crypto'
	| 'buggify'
	| 'end'
> {
	const name = options.name;
	const tie = new WorldTie(options.loop, options);
	const node = options.node === true;
	const rng = options.rng.fork(name);
	const skew = (): number => {
		const skewed = tie.options?.skew ?? 0;
		return typeof skewed === 'number' ? skewed : skewed();
	};
	const born = options.born ?? options.loop.now;
	let ids = 0;
	const live = new Map<number, Task>();

	const arm = (label: string, ms: number, fn: () => void, id = ++ids): number => {
		// (a host timer runs in the context it was set in, as Node's own do: a server's timer is still
		// that server's, its clock skew and its own symbols with it)
		if (node) fn = AsyncResource.bind(fn);
		const task = tie.add(name, SITES ? `${label} @ ${site()}` : label, ms, () => {
			live.delete(id);
			fn();
		});
		if (task !== null) live.set(id, task);
		return node ? (node_handle(id, () => arm(label, ms, fn, id)) as unknown as number) : id;
	};
	const clear = (handle: unknown): void => {
		const id = typeof handle === 'object' && handle !== null ? Number(handle) : (handle as number);
		const task = live.get(id);
		if (task === undefined) return;
		task.cancelled = true;
		live.delete(id);
	};
	// Node's timers are objects (`unref()`, `ref()`, `hasRef()`, `refresh()`), and its own modules
	// call them: the host realm hands out the same shape. `refresh()` starts it again from now,
	// with its own time and callback, even once it has run (Node's own timers do).
	const node_handle = (id: number, again: () => void) => ({
		unref() {
			return this;
		},
		ref() {
			return this;
		},
		hasRef: () => true,
		refresh() {
			clear(id);
			again();
			return this;
		},
		[Symbol.toPrimitive]: () => id
	});

	const RealDate = Date;
	const now = (): number => EPOCH + tie.now + skew();
	// `new Date()` and `Date.now()` read virtual time; `new Date(x)` and the statics are the real ones
	const SimDate = function (this: unknown, ...args: unknown[]) {
		if (!new.target) return new RealDate(now()).toString();
		return args.length === 0
			? new RealDate(now())
			: new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
	} as unknown as DateConstructor;
	Object.setPrototypeOf(SimDate, RealDate);
	Object.defineProperty(SimDate, 'prototype', { value: RealDate.prototype });
	(SimDate as { now: () => number }).now = now;

	const math = Object.create(Math) as Math;
	math.random = () => rng.float();

	/** The next frame, `fn`'s (under `id`, a parked frame's own). */
	const frame = (fn: FrameRequestCallback, id?: number): number => {
		const since = tie.now - born;
		const next = (Math.floor(since / FRAME_MS) + 1) * FRAME_MS - since;
		return arm('frame', next, () => fn(tie.now - born), id);
	};
	/** Frames asked for while the tab was hidden, by id, in the order asked. */
	const parked = new Map<number, FrameRequestCallback>();
	let first_frame = true;

	return {
		realm: name,
		shown: () => {
			const waiting = [...parked];
			parked.clear();
			for (const [id, fn] of waiting) frame(fn, id);
		},
		outstanding: () => live.size,
		pending: () => [...live.values()].map((t) => t.label),
		setTimeout: (fn, ms) => arm('timeout', ms ?? 0, fn),
		clearTimeout: clear,
		setInterval: (fn, ms) => {
			const id = ++ids;
			const every = Math.max(1, ms ?? 0);
			const tick = (): void => {
				arm('interval', every, tick, id);
				fn();
			};
			return arm('interval', every, tick, id);
		},
		clearInterval: clear,
		queueMicrotask: (fn) => globalThis.queueMicrotask(fn),
		requestAnimationFrame: (fn) => {
			// (a hidden tab paints nothing: the frame waits for the tab to be shown. A document's first
			// frame is the DOM library's own: happy-dom writes the document's content in it, after the
			// platform is installed, and a hidden tab's page still loads; test/hidden-tab.node.test.ts)
			const library = first_frame;
			first_frame = false;
			if (!library && tie.options?.hidden?.()) {
				const id = ++ids;
				parked.set(id, fn);
				return id;
			}
			return frame(fn);
		},
		cancelAnimationFrame: (id) => {
			parked.delete(id);
			clear(id);
		},
		requestIdleCallback: (fn, opts) => {
			// a quiet moment comes after the seed's pick of busy time, never past `timeout`
			const wait = rng.between(1, 50);
			const ms = opts?.timeout !== undefined ? Math.min(wait, opts.timeout) : wait;
			return arm('idle', ms, () => {
				const start = tie.now;
				(fn as (deadline: IdleDeadline) => void)({
					didTimeout: opts?.timeout !== undefined && wait > opts.timeout,
					timeRemaining: () => Math.max(0, 50 - (tie.now - start))
				});
			});
		},
		cancelIdleCallback: (id) => clear(id),
		performance: { now: () => tie.now - born },
		buggify: (point) => tie.options?.buggify?.(name, point) ?? false,
		end: () => {
			tie.end();
			live.clear();
			parked.clear();
		},
		Date: SimDate,
		Math: math,
		crypto: {
			getRandomValues: <T extends ArrayBufferView>(array: T): T => {
				const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
				for (let i = 0; i < bytes.length; i++) bytes[i] = rng.int(256);
				return array;
			},
			randomUUID: () => {
				const b = new Uint8Array(16);
				for (let i = 0; i < 16; i++) b[i] = rng.int(256);
				b[6] = (b[6] & 0x0f) | 0x40;
				b[8] = (b[8] & 0x3f) | 0x80;
				const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
				return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`;
			}
		}
	};
}

/**
 * A MessageChannel on the loop (the DOM library has none, and schedulers post to one to get a task):
 * a message posted on one port is a task of the realm that delivers it to the other's `onmessage`
 * and its listeners.
 */
export function message_channel(loop: Loop, realm: string): typeof MessageChannel {
	type Listener = (e: { data: unknown }) => void;
	class Port {
		onmessage: Listener | null = null;
		other: Port | null = null;
		closed = false;
		readonly #listeners = new Set<Listener>();
		postMessage(data: unknown): void {
			const to = this.other;
			if (to === null || this.closed) return;
			loop.add(realm, 'message', 0, () => {
				if (to.closed) return;
				const e = { data };
				to.onmessage?.(e);
				for (const l of to.#listeners) l(e);
			});
		}
		addEventListener(type: string, l: Listener): void {
			if (type === 'message') this.#listeners.add(l);
		}
		removeEventListener(type: string, l: Listener): void {
			if (type === 'message') this.#listeners.delete(l);
		}
		start(): void {}
		close(): void {
			this.closed = true;
		}
	}
	return class {
		readonly port1 = new Port();
		readonly port2 = new Port();
		constructor() {
			this.port1.other = this.port2;
			this.port2.other = this.port1;
		}
	} as unknown as typeof MessageChannel;
}

/**
 * When the host collects garbage is real time: a `FinalizationRegistry` callback or a `WeakRef`
 * that empties would land at a different step each run (an app's query cache drops an entry, and
 * the page fetches again or not). So a run is the schedule where nothing is ever collected: a weak
 * reference holds on, and no finalizer runs. Every real browser may run that schedule too. Once the
 * run is over (`install`'s undo), every target is let go: a reference made in the run may sit in a
 * real registry made before it (Node's own `Request` keeps one), and a target held for good there
 * holds its whole world (test/weak-refs.test.ts).
 */
class StrongRef<T extends object> {
	static readonly #made = new Set<WeakRef<StrongRef<object>>>();
	static readonly #gone = new HOST_FINALIZATION_REGISTRY<WeakRef<StrongRef<object>>>((ref) =>
		StrongRef.#made.delete(ref)
	);

	/** The run is over: every reference made in it lets go of its target. */
	static release(): void {
		for (const ref of StrongRef.#made) {
			const made = ref.deref();
			if (made !== undefined) made.#let_go();
		}
		StrongRef.#made.clear();
	}

	#target: T | undefined;
	constructor(target: T) {
		this.#target = target;
		const me = new HOST_WEAK_REF<StrongRef<object>>(this);
		StrongRef.#made.add(me);
		StrongRef.#gone.register(this, me);
	}
	#let_go(): void {
		this.#target = undefined;
	}
	deref(): T | undefined {
		return this.#target;
	}
	get [Symbol.toStringTag](): string {
		return 'WeakRef';
	}
}

class NeverFinalized {
	register(): void {}
	unregister(): boolean {
		return false;
	}
	get [Symbol.toStringTag](): string {
		return 'FinalizationRegistry';
	}
}

/**
 * Installs a realm's simulated platform on `target` (a tab's window, before its first script runs).
 * `performance` keeps the target's own object with `now` replaced, since the DOM library reads its
 * other members.
 */
export function install(target: object, p: ReturnType<typeof platform>): () => void {
	const t = target as Record<string, unknown>;
	const saved: Array<[object, string, PropertyDescriptor | undefined]> = [];
	const save = (o: object, key: string) =>
		saved.push([o, key, Object.getOwnPropertyDescriptor(o, key)]);
	for (const key of [
		'setTimeout',
		'clearTimeout',
		'setInterval',
		'clearInterval',
		'requestAnimationFrame',
		'cancelAnimationFrame',
		'requestIdleCallback',
		'cancelIdleCallback',
		'Date',
		'Math',
		'buggify'
	] as const) {
		save(t, key);
		Object.defineProperty(t, key, { value: p[key], writable: true, configurable: true });
	}
	// garbage collection runs on the host's real schedule: in the run, nothing is ever collected
	for (const [key, value] of [
		['WeakRef', StrongRef],
		['FinalizationRegistry', NeverFinalized]
	] as const) {
		save(t, key);
		Object.defineProperty(t, key, { value, writable: true, configurable: true });
	}
	const perf = t.performance as { now?: () => number } | undefined;
	if (perf !== undefined) {
		save(perf, 'now');
		Object.defineProperty(perf, 'now', {
			value: p.performance!.now.bind(p.performance),
			configurable: true
		});
	}
	const crypto = t.crypto as Record<string, unknown> | undefined;
	if (crypto !== undefined) {
		save(crypto, 'getRandomValues');
		save(crypto, 'randomUUID');
		Object.defineProperty(crypto, 'getRandomValues', {
			value: p.crypto!.getRandomValues.bind(p.crypto),
			configurable: true
		});
		Object.defineProperty(crypto, 'randomUUID', {
			value: p.crypto!.randomUUID?.bind(p.crypto),
			configurable: true
		});
	}
	return () => {
		for (const [o, key, d] of saved.reverse()) {
			if (d === undefined) delete (o as Record<string, unknown>)[key];
			else Object.defineProperty(o, key, d);
		}
		StrongRef.release();
	};
}
