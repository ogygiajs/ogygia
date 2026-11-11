/**
 * The main-thread half of `with { run: 'worker' }` (the lab's slice of idea 3 in
 * internal/notes/design/workers.md). The compiler turns
 *
 *   import { render_region } from './jobs.ts' with { run: 'worker' };
 *
 * into `threaded(<worker chunk url>, () => import('./jobs.ts'), ['render_region'])`: a typed async
 * proxy. With `LAB_THREADS=0` (or no `worker_threads`) the calls run inline, in this thread, through
 * the dynamic import; otherwise they run on a pool of `worker_threads`, one call per worker at a time.
 *
 * Ownership: `owned(owner, fn)` runs a call for a scope. A queued call whose owner closed never
 * starts; a running one is let finish (a synchronous render cannot be interrupted) and its answer is
 * dropped: the caller already has `STALE`. A call past its deadline terminates its worker (the only
 * real cancel for synchronous work) and the slot respawns.
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { scope, STALE, policy, backoffAfter, type Scope, type Stale } from '@ogygia/machine';

type Fn = (...args: never[]) => unknown;
type Module = Record<string, unknown>;

/** What the worker answers for one call. */
export type Reply =
	| { id: number; ok: true; value: unknown }
	| { id: number; ok: false; error: { name: string; message: string; stack?: string } };

const CALL = Symbol('ogygia.lab.thread-call');

/** A proxied function: the plain call, and the owned one (`owned()` reaches it). */
type Proxied<F extends Fn> = F & {
	[CALL](signal: AbortSignal | undefined, args: Parameters<F>): Promise<Awaited<ReturnType<F>>>;
};

interface Job {
	readonly id: number;
	readonly fn: string;
	readonly args: readonly unknown[];
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: unknown) => void;
	readonly signal: AbortSignal | undefined;
}

/** A thread's failure, with the code the real package would print (`/e/<code>`). */
export class ThreadError extends Error {
	constructor(
		readonly code: 'workers_thread_crashed' | 'workers_call_timeout' | 'workers_call_failed',
		message: string
	) {
		super(message + ' (https://ogygiajs.dev/e/' + code + ')');
		this.name = 'ThreadError';
	}
}

/** How a crashed worker comes back: quickly at first, then slower; a pool that keeps crashing stops. */
const RESPAWN = policy({
	attempts: 5,
	backoff: [0, 50, 250, 1000],
	jitter: 0.2,
	deadline: Infinity
});

class Slot {
	worker: Worker | null = null;
	job: Job | null = null;
	ready: Promise<void> | null = null;
	crashes = 0;
	timer: (() => void) | null = null;
}

/** Counters the lab's /stats route reads. */
export const pool_stats = {
	calls: 0,
	queued_max: 0,
	dropped: 0,
	timeouts: 0,
	crashes: 0,
	spawn_ms: [] as number[]
};

class Pool {
	readonly #url: URL;
	readonly #slots: Slot[];
	readonly #queue: Job[] = [];
	readonly #life: Scope = scope();
	readonly #deadline_ms: number;
	#next = 0;

	constructor(url: URL, size: number, deadline_ms: number) {
		this.#url = url;
		this.#deadline_ms = deadline_ms;
		this.#slots = Array.from({ length: size }, () => new Slot());
		for (const slot of this.#slots) this.#spawn(slot);
		this.#life.defer(() => {
			for (const slot of this.#slots) void slot.worker?.terminate();
		});
	}

	/** Starts every worker now and resolves once each is ready (a server warms its pool at boot). */
	warm(): Promise<void[]> {
		return Promise.all(this.#slots.map((s) => s.ready ?? Promise.resolve()));
	}

	#spawn(slot: Slot): void {
		const started = performance.now();
		const worker = new Worker(this.#url);
		slot.worker = worker;
		slot.ready = new Promise<void>((resolve) => {
			const on_ready = (msg: unknown): void => {
				if ((msg as { ready?: boolean }).ready !== true) return;
				worker.off('message', on_ready);
				pool_stats.spawn_ms.push(performance.now() - started);
				slot.crashes = 0;
				slot.ready = null;
				resolve();
				this.#pump();
			};
			worker.on('message', on_ready);
		});
		worker.on('message', (msg: Reply | { ready: true }) => {
			if ('ready' in msg) return;
			this.#settle(slot, msg);
		});
		// a worker that dies mid-call fails that call; the slot comes back by the respawn policy
		worker.on('exit', (code) => {
			if (slot.worker !== worker || this.#life.closed) return;
			slot.worker = null;
			pool_stats.crashes++;
			const job = slot.job;
			this.#free(slot);
			job?.reject(
				new ThreadError('workers_thread_crashed', 'a worker thread exited with code ' + code)
			);
			slot.crashes++;
			if (slot.crashes >= RESPAWN.attempts) return; // ok: the slot stays down; the others serve
			this.#life.timeout(() => this.#spawn(slot), backoffAfter(RESPAWN, slot.crashes));
		});
		worker.on('error', () => {
			// ok: an uncaught error in the worker ends it; 'exit' above fails the call and respawns
		});
	}

	#settle(slot: Slot, reply: Reply): void {
		const job = slot.job;
		if (job === null || job.id !== reply.id) return;
		this.#free(slot);
		if (reply.ok) job.resolve(reply.value);
		else {
			const e = new ThreadError('workers_call_failed', reply.error.message);
			e.stack = reply.error.stack;
			job.reject(e);
		}
		this.#pump();
	}

	#free(slot: Slot): void {
		slot.timer?.();
		slot.timer = null;
		slot.job = null;
	}

	call(fn: string, args: readonly unknown[], signal: AbortSignal | undefined): Promise<unknown> {
		pool_stats.calls++;
		return new Promise((resolve, reject) => {
			const job: Job = { id: ++this.#next, fn, args, resolve, reject, signal };
			this.#queue.push(job);
			pool_stats.queued_max = Math.max(pool_stats.queued_max, this.#queue.length);
			this.#pump();
		});
	}

	#pump(): void {
		for (const slot of this.#slots) {
			if (slot.job !== null || slot.worker === null || slot.ready !== null) continue;
			let job = this.#queue.shift();
			// a queued call whose owner left never starts (its caller already has STALE)
			while (job?.signal?.aborted) {
				pool_stats.dropped++;
				job.resolve(STALE);
				job = this.#queue.shift();
			}
			if (job === undefined) return;
			slot.job = job;
			const worker = slot.worker;
			if (this.#deadline_ms > 0)
				slot.timer = this.#life.timeout(() => {
					// past its deadline: the only real cancel for synchronous work is the thread itself
					pool_stats.timeouts++;
					this.#free(slot);
					slot.worker = null;
					void worker.terminate();
					job.reject(
						new ThreadError(
							'workers_call_timeout',
							job.fn + ' ran past ' + this.#deadline_ms + ' ms'
						)
					);
					this.#spawn(slot);
				}, this.#deadline_ms);
			worker.postMessage({ id: job.id, fn: job.fn, args: job.args });
		}
	}

	close(): void {
		this.#life.close();
	}
}

/** The pool the lab's server uses; `null` runs every call inline. */
let shared: Pool | null = null;
const pools = new Map<string, Pool>();

/** Thread count from `LAB_THREADS` (0 = inline; unset = cores - 1). */
export function thread_count(): number {
	const env = process.env.LAB_THREADS;
	return env === undefined ? Math.max(1, availableParallelism() - 1) : Number(env);
}

/**
 * What the compiler emits for `import { a, b } from './m.ts' with { run: 'worker' }`: one proxy per
 * imported name. `url` is the worker chunk (an emitted entry that imports the module and serves it);
 * `inline` is the same module as a dynamic import, for the inline mode.
 */
export function threaded<M extends Module>(
	url: string | URL,
	inline: () => Promise<M>,
	names: readonly (keyof M & string)[]
): M {
	const threads = thread_count();
	const key = String(url);
	let pool: Pool | null = null;
	if (threads > 0) {
		pool = pools.get(key) ?? null;
		if (pool === null) {
			pool = new Pool(new URL(key), threads, Number(process.env.LAB_DEADLINE_MS ?? 10_000));
			pools.set(key, pool);
		}
		shared = pool;
	}
	const out: Module = {};
	for (const name of names) {
		const run = async (
			signal: AbortSignal | undefined,
			args: readonly unknown[]
		): Promise<unknown> => {
			if (pool !== null) return pool.call(name, args, signal);
			const mod = await inline();
			return (mod[name] as (...a: readonly unknown[]) => unknown)(...args);
		};
		const proxy = (...args: unknown[]): Promise<unknown> => run(undefined, args);
		Object.defineProperty(proxy, CALL, { value: run });
		Object.defineProperty(proxy, 'name', { value: name });
		out[name] = proxy;
	}
	return out as M;
}

/**
 * `fn` called for `owner`: `STALE` once the owner closes (a queued call never starts, a running
 * one's answer is dropped). Works on a plain function too (an import without `run: 'worker'`).
 */
export function owned<F extends Fn>(
	owner: Scope,
	fn: F
): (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>> | Stale> {
	const call = (fn as Partial<Proxied<F>>)[CALL];
	return (...args) =>
		owner.task((signal) =>
			call ? call(signal, args) : (fn(...args) as Awaited<ReturnType<F>>)
		) as Promise<Awaited<ReturnType<F>> | Stale>;
}

/** Waits for every worker of every pool to be ready (servers call it before listening). */
export async function warm_threads(): Promise<void> {
	await Promise.all([...pools.values()].map((p) => p.warm()));
}

/** Ends every pool (tests, and a server shutting down). */
export function close_threads(): void {
	for (const p of pools.values()) p.close();
	pools.clear();
	shared = null;
}

export { STALE };
export const threads_on = (): boolean => shared !== null;
