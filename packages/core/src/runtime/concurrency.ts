import { clock, queue, scope, type Place, type Queue, type Scope } from '@ogygia/machine';

export interface GateOptions {
	/** The call answers within this long: the wait for a slot and the run together. */
	deadline_ms?: number;
	/** Nobody waits on the call any more once it aborts (a batch whose visitor left, #245): still
	 *  waiting, it leaves the queue at once and its body never runs (the call rejects with the
	 *  signal's reason); already running, it runs on (a body cannot be cancelled). */
	signal?: AbortSignal;
}

const RUN_TIMEOUT = 'region render timeout';
const WAIT_TIMEOUT = 'region render queue timeout';

export class ConcurrencyGate {
	/** The slots (@ogygia/machine `queue()`, first come first served): a freed slot is handed to the
	 *  next call in the same step, and a call whose deadline came is passed over. */
	readonly #slots: Queue<Waiter>;
	readonly #limit: number;
	#abandoned = 0;

	constructor(max: number) {
		const limit = Math.max(1, max);
		this.#limit = Number.isFinite(limit) ? Math.ceil(limit) : Number.MAX_SAFE_INTEGER;
		this.#slots = queue<Waiter>({
			name: 'render gate',
			max: this.#limit,
			start: (w, place) => w.enter(place),
			stale: (w) => w.gone(),
			now: clock.mono
		});
	}

	async run<T>(fn: () => Promise<T>, options: GateOptions = {}): Promise<T> {
		const { deadline_ms, signal } = options;
		if (signal?.aborted) throw signal.reason;
		const deadline = deadline_ms === undefined ? Infinity : clock.mono() + deadline_ms;
		const call = scope();
		try {
			const slot = await this.#enter(deadline, signal, call);
			if (signal?.aborted) {
				slot.release();
				throw signal.reason;
			}
			let body: Promise<T>;
			try {
				body = fn();
			} catch (error) {
				body = Promise.reject(error);
			}
			let holds = true;
			const end = () => {
				if (holds) {
					holds = false;
					slot.release();
				} else this.#abandoned--;
			};
			body.then(end, end);
			if (deadline === Infinity) return await body;
			return await within(call, body, deadline - clock.mono(), () => {
				if (!holds) return;
				holds = false;
				// @why Svelte's server `render()` cannot be cancelled: an abandoned body runs on (test: test/concurrency.test.ts › four renders on a hung upstream never stop the fifth hole: it renders at once)
				this.#abandoned++;
				slot.release();
			});
		} finally {
			call.close();
		}
	}

	/** Bodies running that someone waits on (the limit counts these). */
	get active(): number {
		return this.#slots.holding;
	}

	/** Bodies past their deadline still running: nobody waits on them, and they hold no slot. */
	get abandoned(): number {
		return this.#abandoned;
	}

	/** Calls waiting for a slot. */
	get waiting(): number {
		return this.#slots.waiting;
	}

	/** A slot: at once when one is free, else in turn (or the deadline passes, or the signal aborts,
	 *  first). A waiter that gives up leaves the queue at once: with every slot held by bodies that
	 *  never end, nothing else would drop it, and the queue would grow by the request rate. */
	#enter(deadline: number, signal: AbortSignal | undefined, call: Scope): Promise<Place> {
		return new Promise((resolve, reject) => {
			let entered = false;
			const waiter: Waiter = {
				enter: (place) => {
					entered = true;
					resolve(place);
				},
				gone: () => reject(signal?.aborted ? signal.reason : new Error(WAIT_TIMEOUT))
			};
			const slots = this.#slots;
			const free = slots.waiting === 0 && slots.holding < this.#limit;
			slots.push(waiter, free ? undefined : deadline);
			if (signal && !entered) call.on(signal, 'abort', () => this.#slots.cancel(waiter));
		});
	}
}

type Waiter = { enter: (place: Place) => void; gone: () => void };

/** Whether `error` is a call's run timeout: its body ran past the deadline and was abandoned. */
export function is_run_timeout(error: unknown): boolean {
	return error instanceof Error && error.message === RUN_TIMEOUT;
}

function within<T>(call: Scope, work: Promise<T>, ms: number, on_timeout: () => void): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		call.timeout(() => {
			on_timeout();
			reject(new Error(RUN_TIMEOUT));
		}, timer_ms(ms));
		work.then(resolve, reject);
	});
}

function timer_ms(ms: number): number {
	return Math.min(2_147_483_647, Math.max(0, ms));
}

/** Max concurrent region SSR renders per process (CPU amp under valid MAC). */
export const REGION_RENDER_CONCURRENCY = 4;
