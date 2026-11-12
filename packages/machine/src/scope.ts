/**
 * One owner for everything a piece of work holds: its listeners, timers, observers, child work and
 * cleanups, released together, exactly once, when the owner ends.
 *
 *   const page = scope();
 *   page.on(window, 'popstate', on_pop);
 *   page.timeout(retry, 500);
 *   page.watch(new IntersectionObserver(on_seen)).observe(el);
 *   const html = await page.task((signal) => fetch(url, { signal }).then((r) => r.text()));
 *   if (html === STALE) return; // the page was left meanwhile
 *   ...
 *   page.close(); // every listener off, every timer cleared, the fetch aborted
 *
 * A scope is open until `close()`. Closing it closes its children first (newest first), then aborts
 * its `signal`, then lets go of what it holds (listeners, timers) and runs its cleanups, newest
 * first. Anything given to a scope that is already closed is released at once: a cleanup runs, an
 * observer disconnects, a disposable is disposed, and a listener or a timer is never set. So code
 * that runs late, after its owner ended, cannot leave anything behind.
 *
 * Each visit of a machine to a state is one (`m.scope`): leaving the state closes it.
 *
 * Speed: the abort controller, the child set, the held set and the cleanup list are each made the
 * first time they are needed. A scope nothing was given to costs one small object.
 */
import { machine_error, report } from './messages.ts';
import { noop } from './noop.ts';
import { tasks, timers } from './ports.ts';
import { STALE, whole, type Fresh, type Stale } from './stale.ts';

// (a runtime without the explicit-resource-management symbols gets the registered ones, as the
// TypeScript and esbuild `using` helpers do)
export const DISPOSE: typeof Symbol.dispose =
	Symbol.dispose ?? (Symbol.for('Symbol.dispose') as typeof Symbol.dispose);
const ASYNC_DISPOSE: typeof Symbol.asyncDispose =
	Symbol.asyncDispose ?? (Symbol.for('Symbol.asyncDispose') as typeof Symbol.asyncDispose);

/** Something with `addEventListener` / `removeEventListener`: a window, a document, an element, an
 *  AbortSignal, a worker, an EventSource. */
export interface ListenerTarget {
	addEventListener(type: string, listener: never, options?: never): void;
	removeEventListener(type: string, listener: never, options?: never): void;
}

/** Something with `on` / `off`: a Node EventEmitter (a child process, a socket, a request), Vite's
 *  `import.meta.hot`. */
export interface Emitter {
	on(type: string, listener: never): unknown;
	off(type: string, listener: never): unknown;
}

/** The event a target hands its `type` listener, read from its `on<type>` handler (a window's
 *  `click` is a MouseEvent); an `Event` when the target names none. */
export type EventOf<T, K extends string> = T extends { [P in `on${K}`]: infer H }
	? [H] extends [((event: infer E) => unknown) | null | undefined]
		? E
		: Event
	: Event;

/** When a `timeout` runs: after `ms`, at the next frame, or when the browser is idle. */
export type When = number | 'frame' | 'idle';

/** Anything that stops watching with `disconnect()`: a Mutation, Intersection, Resize or
 *  Performance observer. */
export interface Watcher {
	disconnect(): void;
}

export interface Scope {
	/** Aborts when the scope closes (already aborted on a closed scope). */
	readonly signal: AbortSignal;
	/** It has closed. */
	readonly closed: boolean;
	/**
	 * Listens to `type` on `target` until the scope closes (or the returned function is called). A
	 * DOM-style target or a Node-style emitter. On a closed scope it does not listen at all.
	 */
	on<T extends ListenerTarget, K extends string>(
		target: T,
		type: K,
		listener: (event: EventOf<T, K>) => void,
		options?: boolean | AddEventListenerOptions
	): () => void;
	on<A extends unknown[]>(
		target: Emitter,
		type: string,
		listener: (...args: A) => void
	): () => void;
	/**
	 * Runs `fn` once, after `when` (ms, `'frame'`, or `'idle'`), unless the scope closes first (or
	 * the returned function is called). Never keeps a server process alive: its owner does.
	 */
	timeout(fn: () => void, when: When): () => void;
	/** Runs `fn` every `ms` until the scope closes (or the returned function is called). */
	every(fn: () => void, ms: number): () => void;
	/** Disconnects `observer` when the scope closes (at once on a closed scope). Returns it. */
	watch<O extends Watcher>(observer: O): O;
	/**
	 * Runs `work` for this scope. Closing aborts `signal` and settles the task with `STALE` right
	 * then, even when `work` never finishes: an answer only lands while its scope is open. A failure
	 * after the scope closed is `STALE` too. A closed scope gives `STALE` without running `work`.
	 * Work that answers `STALE`, or an array with `STALE` in it (a `Promise.all` with a stale part),
	 * gives `STALE`: if anything it waited on is stale, the whole task is.
	 */
	task<R>(work: (signal: AbortSignal) => R): Promise<Fresh<Awaited<R>> | Stale>;
	/** A scope that closes when this one does, before this one's own cleanups. It can close sooner
	 *  on its own. A closed scope's child is closed. */
	child(): Scope;
	/**
	 * Runs `cleanup` once, when the scope closes; cleanups run newest first. One that throws does
	 * not stop the others: `close()` throws once all have run. On a closed scope it runs at once.
	 */
	defer(cleanup: () => void): void;
	/** Disposes `disposable` (`Symbol.dispose` or `Symbol.asyncDispose`) when the scope closes (at
	 *  once on a closed scope). Returns it. */
	adopt<D extends Disposable | AsyncDisposable>(disposable: D): D;
	/**
	 * Closes it: its children, then its signal, then what it holds and its cleanups (newest first).
	 * Safe to call twice. Throws what the cleanups (or the releases of what it holds) threw (an
	 * AggregateError for more than one), once all have run. An async disposal that fails is reported, as it has nobody to throw to: use
	 * `await using` (or `[Symbol.asyncDispose]()`) to wait for them and get their errors.
	 */
	close(): void;
	[Symbol.dispose](): void;
	[Symbol.asyncDispose](): Promise<void>;
}

/** The longest delay a timer holds (2^31 - 1 ms): Node and browsers run a longer one after 1 ms. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** A delay a timer can hold. */
export function is_time(ms: unknown): ms is number {
	return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= MAX_TIMEOUT_MS;
}

/**
 * Every scope is one of these. Fields are plain (`_`), not `#private`: a machine reads and writes
 * its visit's scope on every move, where a `#` field costs about twice as much on V8.
 */
class Scoped implements Scope {
	/** The machine whose visit it is, or null: names it in what it throws (`machine hole`). */
	_machine: string | null;
	_parent: Scoped | null;
	_closed = false;
	_abort: AbortController | null = null;
	_children: Set<Scoped> | null = null;
	/** Listeners and timers it holds, each its own release (a fired timer lets go of itself). */
	_held: Set<() => void> | null = null;
	_defers: (() => void)[] | null = null;
	/** Async disposals started by close, and whether a caller waits for them. */
	_settling: Promise<unknown>[] | null = null;
	_awaited = false;
	/** Its close is running (a cleanup that adopts goes with the close's own disposals). */
	_closing = false;

	constructor(parent: Scoped | null, machine: string | null) {
		this._parent = parent;
		this._machine = machine;
	}

	/** How what it throws names it (made only then: a visit's scope costs no string). */
	get _label(): string {
		return this._machine === null ? 'scope' : 'machine ' + this._machine;
	}

	get closed(): boolean {
		return this._closed;
	}

	get signal(): AbortSignal {
		if (this._abort !== null) return this._abort.signal;
		const abort = (this._abort = new AbortController());
		if (this._closed) abort.abort();
		return abort.signal;
	}

	/** Holds `release` until the scope closes; the returned function lets go of it sooner. */
	_hold(release: () => void): () => void {
		const held = (this._held ??= new Set());
		let done = false;
		const early = () => {
			if (done) return;
			done = true;
			this._held?.delete(early);
			release();
		};
		held.add(early);
		return early;
	}

	on(
		target: ListenerTarget | Emitter,
		type: string,
		listener: (...args: never[]) => void,
		options?: boolean | AddEventListenerOptions
	): () => void {
		if (this._closed) return noop;
		if ('addEventListener' in target) {
			const t = target as unknown as EventTarget;
			const heard = listener as unknown as EventListener;
			// a once listener that fired is gone from the target: it lets go of itself, as a fired
			// timer does, so a long-lived scope does not pile them up
			let release: () => void = noop;
			const fn: EventListener =
				typeof options === 'object' && options.once === true
					? function (this: EventTarget, event) {
							release();
							heard.call(this, event);
						}
					: heard;
			t.addEventListener(type, fn, options);
			// (removed by its capture alone, as an object: Node's EventTarget does not match a bare
			// `true` on removal, and would keep a capture listener)
			const capture = {
				capture: typeof options === 'boolean' ? options : options?.capture === true
			};
			return (release = this._hold(() => t.removeEventListener(type, fn, capture)));
		}
		const e = target as unknown as {
			on(type: string, fn: unknown): unknown;
			off(type: string, fn: unknown): unknown;
		};
		e.on(type, listener);
		return this._hold(() => e.off(type, listener));
	}

	timeout(fn: () => void, when: When): () => void {
		if (when !== 'frame' && when !== 'idle' && !is_time(when))
			throw machine_error('machine_bad_time', { where: 'timeout()', ms: String(when) });
		if (this._closed) return noop;
		let release!: () => void;
		const fire = () => {
			release();
			fn();
		};
		// (no frames or idle time here, a server or a worker: the ports fall back to the next task)
		if (when === 'frame') release = this._hold(tasks.frame(fire));
		else if (when === 'idle') release = this._hold(tasks.idle(fire));
		else {
			const timer = timers.after(fire, typeof when === 'number' ? when : 0);
			release = this._hold(() => timers.cancel(timer));
		}
		return release;
	}

	every(fn: () => void, ms: number): () => void {
		if (!is_time(ms)) throw machine_error('machine_bad_time', { where: 'every()', ms: String(ms) });
		if (this._closed) return noop;
		const timer = timers.every(fn, ms);
		return this._hold(() => timers.cancel(timer));
	}

	watch<O extends Watcher>(observer: O): O {
		this.defer(() => observer.disconnect());
		return observer;
	}

	task<R>(work: (signal: AbortSignal) => R): Promise<Fresh<Awaited<R>> | Stale> {
		if (this._closed) return Promise.resolve(STALE);
		const signal = this.signal;
		let out: R | Promise<never>;
		try {
			out = work(signal);
		} catch (error) {
			out = Promise.reject(error);
		}
		// (work that closed its own scope before it returned, by moving its machine on: the abort
		// came before anyone could listen for it)
		if (this._closed) {
			Promise.resolve(out).then(noop, noop);
			return Promise.resolve(STALE);
		}
		return new Promise((resolve, reject) => {
			// settles the moment the scope closes, even when `work` ignores its signal and never does
			const on_close = () => resolve(STALE);
			signal.addEventListener('abort', on_close, { once: true });
			Promise.resolve(out).then(
				(value) => {
					signal.removeEventListener('abort', on_close);
					resolve(this._closed ? STALE : whole(value as Awaited<R>));
				},
				(error: unknown) => {
					signal.removeEventListener('abort', on_close);
					if (this._closed) resolve(STALE);
					else reject(error);
				}
			);
		});
	}

	child(): Scope {
		if (this._closed) return closed_scope;
		const child = new Scoped(this, null);
		(this._children ??= new Set()).add(child);
		return child;
	}

	defer(cleanup: () => void): void {
		if (this._closed) cleanup();
		else (this._defers ??= []).push(cleanup);
	}

	adopt<D extends Disposable | AsyncDisposable>(disposable: D): D {
		const d = disposable as Partial<Disposable & AsyncDisposable>;
		if (typeof d[DISPOSE] === 'function') this.defer(() => (d[DISPOSE] as () => void).call(d));
		else if (typeof d[ASYNC_DISPOSE] === 'function') {
			const dispose = () => Promise.resolve((d[ASYNC_DISPOSE] as () => Promise<void>).call(d));
			// closed already (late work): its close has looked at its disposals, so this one is said
			// here. One adopted by a cleanup of its own close still goes with the close's own.
			if (this._closed && !this._closing) this._said(dispose());
			else this.defer(() => void (this._settling ??= []).push(dispose()));
		} else throw machine_error('machine_not_disposable', { value: typeof disposable });
		return disposable;
	}

	/** An async disposal nobody waits for: its failure is said with the code. */
	_said(done: Promise<unknown>): void {
		done.then(undefined, (error: unknown) =>
			report('machine_dispose_failed', { owner: this._label }, error)
		);
	}

	close(): void {
		if (this._closed) return;
		this._closed = true;
		this._closing = true;
		this._parent?._children?.delete(this);
		this._parent = null;
		let errors: unknown[] | null = null;
		const children = this._children;
		this._children = null;
		if (children !== null) {
			const list = [...children];
			for (let i = list.length - 1; i >= 0; i--) {
				try {
					list[i].close();
				} catch (error) {
					(errors ??= []).push(error);
				}
			}
		}
		this._abort?.abort();
		// (a release that throws, an `off` of a target that is gone, is one more error: the others
		// and the cleanups still run)
		const held = this._held;
		this._held = null;
		if (held !== null)
			for (const release of held) {
				try {
					release();
				} catch (error) {
					(errors ??= []).push(error);
				}
			}
		const defers = this._defers;
		this._defers = null;
		if (defers !== null) {
			for (let i = defers.length - 1; i >= 0; i--) {
				try {
					defers[i]();
				} catch (error) {
					(errors ??= []).push(error);
				}
			}
		}
		this._closing = false;
		if (this._settling !== null && !this._awaited)
			for (const done of this._settling) this._said(done);
		if (errors !== null)
			throw errors.length === 1
				? errors[0]
				: new AggregateError(errors, `[ogygia] ${this._label}: ${errors.length} cleanups threw`);
	}

	[DISPOSE](): void {
		this.close();
	}

	async [ASYNC_DISPOSE](): Promise<void> {
		const errors: unknown[] = [];
		if (!this._closed) {
			this._awaited = true;
			try {
				this.close();
			} catch (error) {
				errors.push(error);
			}
		}
		for (const done of await Promise.allSettled(this._settling ?? []))
			if (done.status === 'rejected' && this._awaited) errors.push(done.reason);
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1)
			throw new AggregateError(errors, `[ogygia] ${this._label}: ${errors.length} cleanups threw`);
	}
}

/** The scope of an owner that has already ended: everything given to it is released at once. */
const closed_scope = new Scoped(null, null);
closed_scope._closed = true;
export const CLOSED: Scope = closed_scope;

/** The scope of a visit of machine `name` (named in what its close throws: `machine hole`). */
export function visit_scope(name: string): Scope {
	return new Scoped(null, name);
}

/** A new scope; with `parent`, one that closes when the parent does (`parent.child()`). */
export function scope(parent?: Scope): Scope {
	return parent === undefined ? new Scoped(null, null) : parent.child();
}
