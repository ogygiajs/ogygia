/**
 * DETERMINISTIC SIMULATION (#314): fast-check's scheduler decides the order async work finishes in
 * (an upstream's answer, a store write, a timer, a stream's next chunk, the next step of the test),
 * tries many orders, and fails on any broken rule. A failing run prints its seed and path, and
 * replays the same order.
 *
 *   await simulate.check(
 *     [fc.array(fc.constantFrom('read', 'drop'), { maxLength: 8 })],
 *     async (sim, steps) => {
 *       sim.fetch(() => Response.json({ body: 'x' })); // every fetch answers when the scheduler says
 *       sim.always('one fetch per key', () => (out > 1 ? `${out} fetches out` : null));
 *       await sim.play(steps.map((step) => [step, () => (step === 'read' ? peer.doc('/p') : peer.drop('all'))]));
 *     }
 *   );
 *
 * The run owns every async edge of the code under test, or it is not deterministic:
 * - time: `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`,
 *   `AbortSignal.timeout` and `Date.now` read one clock the run owns. Timers fire in the order they
 *   are due, and "time passes" is a step the scheduler picks like any other: an answer can come
 *   before a 0 ms timer, or after a 10 s deadline. Past `horizon` no timer fires.
 * - fetch (`sim.fetch`): each call is answered when the scheduler picks it; an aborted signal
 *   rejects it at once, as a real fetch does.
 * - anything else that answers later (`sim.later`): a store, a render, a lock.
 * - streams (`sim.stream`): each chunk comes when the scheduler picks it.
 * - the test's own steps (`sim.play`): each starts when the scheduler picks it, and runs beside the
 *   ones still out.
 *
 * Rules: `always` ones are checked after every step and at the end; `finally` ones at the end only,
 * once nothing is left to run. Every call `play` started must have settled (nothing hangs), no
 * timer callback may throw, and no promise may be rejected with nobody to hear it. Each area's own
 * rules (the server's, from core's src/server/rules.ts) go in with `finally`.
 *
 * Runs are seeded (314 unless `OGYGIA_SIM_SEED` says), so CI tries the same orders every time.
 * `OGYGIA_SIM_RUNS` sets how many; `OGYGIA_SIM_ONLY` counts only the rules whose name holds it (to
 * time one rule on old code).
 */
import fc from 'fast-check';

export { fc };

/** A rule's check: what it found broken, or null when it holds. */
export type SimRule = () => string | null;

/** A step of the test: its label (the scheduler's report names it) and what it does. */
export type SimStep = readonly [label: string, run: () => unknown];

export interface SimOptions {
	/** Virtual ms past which no timer fires (an `every` would otherwise run forever). Default 120 s. */
	horizon?: number;
}

export interface CheckOptions extends SimOptions {
	/** Runs (orders and inputs tried). Default 200; `OGYGIA_SIM_RUNS` sets every property's. */
	runs?: number;
	/** The seed. Default 314, so CI tries the same orders every time; `OGYGIA_SIM_SEED` sets it. */
	seed?: number;
	/** Replays one failure (with its seed): the `path` a failed run printed. */
	path?: string;
}

export interface Sim {
	/** The scheduler of this run. */
	readonly s: fc.Scheduler;
	/** Virtual ms since the run began. */
	elapsed(): number;
	/** Timers set and not yet fired or cleared (what a closed owner must not leave behind). */
	timers(): number;
	/** `make()`'s value, when the scheduler picks it (an answer that takes some time). */
	later<T = void>(label: string, make?: () => T | PromiseLike<T>): Promise<T>;
	/** Answers every `fetch` of the run with `answer`, when the scheduler picks it. The requests,
	 *  in the order they were made, are `fetches`. */
	fetch(answer: (request: Request, n: number) => Response | PromiseLike<Response>): void;
	/** The requests `fetch` was asked for so far. */
	readonly fetches: readonly Request[];
	/** A stream of `chunks`, each one read when the scheduler picks it. `cancelled()`: its reader
	 *  let go of it before its end. */
	stream(
		label: string,
		chunks: readonly string[]
	): { body: ReadableStream<Uint8Array>; cancelled: () => boolean };
	/** A rule checked after each step and at the end. */
	always(name: string, check: SimRule): void;
	/** A rule checked at the end, once nothing is left to run. */
	finally(name: string, check: SimRule): void;
	/** Says a rule broke now (found inside a stub: a second fetch out for one key). */
	broke(name: string, detail: string): void;
	/** Holds `work` to the "nothing hangs" rule: it must settle before the run ends. */
	track<T>(label: string, work: T): T;
	/** Runs `steps`, each when the scheduler picks it, beside the ones still out; then runs
	 *  everything left (answers, timers) to the end. */
	play(steps: readonly SimStep[]): Promise<void>;
	/** Runs everything left (answers, timers up to the horizon) to the end. */
	settle(): Promise<void>;
}

type Timer = { id: number; due: number; seq: number; fn: () => void; every: number };

type Clocked = {
	setTimeout: typeof setTimeout;
	clearTimeout: typeof clearTimeout;
	setInterval: typeof setInterval;
	clearInterval: typeof clearInterval;
	requestAnimationFrame?: (fn: (at: number) => void) => number;
	cancelAnimationFrame?: (id: number) => void;
	requestIdleCallback?: (fn: (deadline: unknown) => void) => number;
	cancelIdleCallback?: (id: number) => void;
	fetch: typeof fetch;
};
const host = globalThis as unknown as Clocked;

/** The host's own, taken before any run swaps them: a real task boundary between scheduler waits. */
const real_now = Date.now;
const real_abort_timeout = AbortSignal.timeout;
const real_set_immediate = (globalThis as { setImmediate?: (fn: () => void) => unknown })
	.setImmediate;
const macrotask = (): Promise<void> =>
	new Promise<void>((r) => {
		if (real_set_immediate !== undefined) real_set_immediate(r);
		else {
			// (a browser: a message is a task, with no 4 ms clamp)
			const channel = new MessageChannel();
			channel.port1.onmessage = () => {
				channel.port1.close();
				r();
			};
			channel.port2.postMessage(null);
		}
	});

/** The most real task boundaries a run waits through for work the scheduler does not see yet. */
const SETTLE_ROUNDS = 1000;

const encoder = new TextEncoder();
const noop = (): void => {};

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const env_number = (name: string): number | undefined => {
	const v = env?.[name];
	return v === undefined || v === '' ? undefined : Number(v);
};
const only = env?.OGYGIA_SIM_ONLY || undefined;

class Run implements Sim {
	readonly s: fc.Scheduler;
	readonly fetches: Request[] = [];
	_horizon: number;
	_clock = 0;
	_base = real_now();
	_timers = new Map<number, Timer>();
	_next_id = 1;
	_seq = 0;
	_ticking = false;
	_always: Array<{ name: string; check: SimRule }> = [];
	_finally: Array<{ name: string; check: SimRule }> = [];
	_broken: string[] = [];
	_tracked: Array<{ label: string; settled: boolean }> = [];
	_restore: Array<() => void> = [];

	constructor(s: fc.Scheduler, o: SimOptions) {
		this.s = s;
		this._horizon = o.horizon ?? 120_000;
	}

	elapsed(): number {
		return this._clock;
	}

	timers(): number {
		return this._timers.size;
	}

	later<T = void>(label: string, make?: () => T | PromiseLike<T>): Promise<T> {
		return this.s.schedule(Promise.resolve(), label).then(() => make?.() as T);
	}

	fetch(answer: (request: Request, n: number) => Response | PromiseLike<Response>): void {
		const fetch_stub = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const request = new Request(input, init);
			const n = this.fetches.push(request) - 1;
			const signal = init?.signal ?? undefined;
			return new Promise<Response>((resolve, reject) => {
				if (signal?.aborted) return reject(signal.reason);
				const on_abort = () => reject(signal!.reason);
				// oxlint-disable-next-line ogygia/owned-effects -- a fetch's own abort listener, as a real fetch has: taken off when it settles, below
				signal?.addEventListener('abort', on_abort, { once: true });
				this.later(`answer ${request.method} ${new URL(request.url).pathname}`, () =>
					signal?.aborted ? Promise.reject(signal.reason) : answer(request, n)
				)
					.then(resolve, reject)
					.finally(() => signal?.removeEventListener('abort', on_abort));
			});
		};
		const was = host.fetch;
		host.fetch = fetch_stub as typeof fetch;
		this._restore.push(() => (host.fetch = was));
	}

	stream(
		label: string,
		chunks: readonly string[]
	): { body: ReadableStream<Uint8Array>; cancelled: () => boolean } {
		let at = 0;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>(
			{
				pull: (controller) =>
					this.later(`${label}: chunk ${at + 1} of ${chunks.length}`, () => {
						if (cancelled) return;
						if (at < chunks.length) controller.enqueue(encoder.encode(chunks[at++]));
						if (at >= chunks.length) controller.close();
					}),
				cancel: () => {
					cancelled = at < chunks.length;
				}
			},
			{ highWaterMark: 0 }
		);
		return { body, cancelled: () => cancelled };
	}

	always(name: string, check: SimRule): void {
		this._always.push({ name, check });
	}

	finally(name: string, check: SimRule): void {
		this._finally.push({ name, check });
	}

	broke(name: string, detail: string): void {
		// (`OGYGIA_SIM_ONLY`: only the rules whose name has it count, to time one rule on its own)
		if (only !== undefined && !name.includes(only)) return;
		if (this._broken.length < 20) this._broken.push(`${name}: ${detail}`);
	}

	track<T>(label: string, work: T): T {
		if (work != null && typeof (work as { then?: unknown }).then === 'function') {
			const t = { label, settled: false };
			this._tracked.push(t);
			(work as unknown as PromiseLike<unknown>).then(
				() => (t.settled = true),
				() => (t.settled = true)
			);
		}
		return work;
	}

	_check(rules: ReadonlyArray<{ name: string; check: SimRule }>): void {
		for (const { name, check } of rules) {
			let detail: string | null;
			try {
				detail = check();
			} catch (error) {
				detail = 'the check threw: ' + String(error);
			}
			if (detail !== null) this.broke(name, detail);
		}
	}

	async play(steps: readonly SimStep[]): Promise<void> {
		const seq = this.s.scheduleSequence(
			steps.map(([label, run]) => ({
				label,
				builder: async () => {
					try {
						this.track(label, run());
					} catch (error) {
						this.broke('steps', `"${label}" threw: ${String(error)}`);
					}
					this._check(this._always);
				}
			}))
		);
		await this.settle();
		if (!seq.done) this.broke('steps', 'the steps never all ran');
	}

	async settle(): Promise<void> {
		for (let i = 0; i < SETTLE_ROUNDS; i++) {
			await this.s.waitIdle();
			await macrotask();
			if (this.s.count() === 0) return;
		}
		this.broke('settles', `work was still scheduled after ${SETTLE_ROUNDS} rounds`);
	}

	/** The verdict at the end: every rule, every tracked call settled. */
	_end(): string[] {
		this._check(this._always);
		this._check(this._finally);
		const hung = this._tracked.filter((t) => !t.settled);
		if (hung.length > 0)
			this.broke('hangs', `never settled: ${hung.map((t) => t.label).join(', ')}`);
		return this._broken;
	}

	// ── the clock ────────────────────────────────────────────────────────────────────────────

	_add(fn: () => void, ms: number, every: boolean): number {
		const wait = Math.max(0, Number.isFinite(ms) ? ms : 0);
		const id = this._next_id++;
		this._timers.set(id, {
			id,
			due: this._clock + wait,
			seq: this._seq++,
			fn,
			every: every ? Math.max(1, wait) : 0
		});
		this._arm();
		return id;
	}

	_earliest(): Timer | null {
		let first: Timer | null = null;
		for (const t of this._timers.values())
			if (first === null || t.due < first.due || (t.due === first.due && t.seq < first.seq))
				first = t;
		return first;
	}

	/** One "time passes" step in the scheduler while a timer is due within the horizon. */
	_arm(): void {
		if (this._ticking) return;
		const first = this._earliest();
		if (first === null || first.due > this._horizon) return;
		this._ticking = true;
		// (it never rejects: a timer that throws is said by `_fire`)
		this.s.schedule(Promise.resolve(), 'time passes').then(() => this._fire(), noop); // ok: never rejects
	}

	_fire(): void {
		this._ticking = false;
		const t = this._earliest();
		if (t !== null && t.due <= this._horizon) {
			this._clock = Math.max(this._clock, t.due);
			if (t.every > 0) {
				t.due += t.every;
				t.seq = this._seq++;
			} else this._timers.delete(t.id);
			try {
				t.fn();
			} catch (error) {
				this.broke('timer throws', String(error));
			}
		}
		this._arm();
	}

	_install(): void {
		const swap = <K extends keyof Clocked>(key: K, value: Clocked[K]) => {
			if (key.endsWith('AnimationFrame') || key.endsWith('IdleCallback'))
				if (host[key] === undefined) return;
			const was = host[key];
			host[key] = value;
			this._restore.push(() => (host[key] = was));
		};
		const clear = (id: unknown): void => {
			this._timers.delete(id as number);
		};
		swap('setTimeout', ((fn: () => void, ms?: number, ...args: unknown[]) =>
			this._add(() => fn(...(args as [])), ms ?? 0, false)) as unknown as typeof setTimeout);
		swap('clearTimeout', clear as typeof clearTimeout);
		swap('setInterval', ((fn: () => void, ms?: number, ...args: unknown[]) =>
			this._add(() => fn(...(args as [])), ms ?? 0, true)) as unknown as typeof setInterval);
		swap('clearInterval', clear as typeof clearInterval);
		swap('requestAnimationFrame', (fn) => this._add(() => fn(this._clock), 16, false));
		swap('cancelAnimationFrame', clear);
		swap('requestIdleCallback', (fn) =>
			this._add(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 1, false)
		);
		swap('cancelIdleCallback', clear);
		Date.now = () => this._base + this._clock;
		this._restore.push(() => (Date.now = real_now));
		AbortSignal.timeout = (ms: number) => {
			const abort = new AbortController();
			this._add(
				() => abort.abort(new DOMException('The operation timed out.', 'TimeoutError')),
				ms,
				false
			);
			return abort.signal;
		};
		this._restore.push(() => (AbortSignal.timeout = real_abort_timeout));
		// a rejection nobody hears is a broken rule of every area
		const on_unheard = (reason: unknown) => this.broke('unhandled rejection', String(reason));
		const proc = (globalThis as { process?: NodeJS.Process }).process;
		if (proc?.on !== undefined && typeof window === 'undefined') {
			proc.on('unhandledRejection', on_unheard);
			this._restore.push(() => proc.off('unhandledRejection', on_unheard));
		} else if (typeof window !== 'undefined') {
			const on_event = (e: PromiseRejectionEvent) => on_unheard(e.reason);
			// oxlint-disable-next-line ogygia/owned-effects -- the run's own: taken off when the run ends (`_uninstall`)
			window.addEventListener('unhandledrejection', on_event);
			this._restore.push(() => window.removeEventListener('unhandledrejection', on_event));
		}
	}

	_uninstall(): void {
		for (const restore of this._restore.splice(0).reverse()) restore();
		this._timers.clear();
	}
}

/** One run: `body` under a clock and a fetch the scheduler owns; throws the rules it broke. */
export async function simulate(
	s: fc.Scheduler,
	body: (sim: Sim) => Promise<void>,
	options: SimOptions = {}
): Promise<void> {
	const run = new Run(s, options);
	run._install();
	let broken: string[];
	try {
		await body(run);
		await run.settle();
		broken = run._end();
	} finally {
		run._uninstall();
	}
	if (broken.length > 0) throw new Error('broken rules:\n  ' + broken.join('\n  '));
}

/**
 * A property: for `runs` inputs drawn from `arbitraries` and as many orders, `body` breaks no rule.
 * Seeded (the same orders on every CI run); a failure says its seed and path, which replay it.
 */
simulate.check = async function check<Ts extends unknown[]>(
	arbitraries: { [K in keyof Ts]: fc.Arbitrary<Ts[K]> },
	body: (sim: Sim, ...args: Ts) => Promise<void>,
	options: CheckOptions = {}
): Promise<void> {
	const property = fc.asyncProperty(
		fc.scheduler(),
		...(arbitraries as unknown as fc.Arbitrary<unknown>[]),
		(s: fc.Scheduler, ...args: unknown[]) =>
			simulate(s, (sim) => body(sim, ...(args as Ts)), options)
	);
	await fc.assert(property as fc.IAsyncProperty<unknown[]>, {
		numRuns: env_number('OGYGIA_SIM_RUNS') ?? options.runs ?? 200,
		seed: env_number('OGYGIA_SIM_SEED') ?? options.seed ?? 314,
		...(options.path === undefined ? {} : { path: options.path })
	});
};
