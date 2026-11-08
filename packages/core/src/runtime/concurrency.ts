/**
 * Shared concurrency gate — client region fetches (SI-STORM) and server region SSR (M1).
 * Caps in-flight work; waiters queue FIFO. Does not cancel running work (see INVARIANTS.md).
 *
 * The promise: never more than `limit` bodies running that someone still waits on (#195), and a
 * call with a deadline answers within it.
 * - A freed slot is HANDED to the next waiter in the same step: it is never free in between, so a
 *   call arriving while the waiter resumes queues behind it instead of entering beside it.
 * - `deadline_ms` covers the whole call, the wait for a slot and the run together. A waiter whose
 *   deadline passes gives up and never runs. A body still running at its deadline is ABANDONED: its
 *   caller gets the timeout and its slot goes to the next call at once. Svelte's `render()` cannot
 *   be cancelled, so the body runs on, counted in `abandoned` until it ends; it never blocks a slot,
 *   or a hung upstream (renders that never end) would hold every slot and take every hole down.
 */

export interface GateOptions {
	/** The call answers within this long: the wait for a slot and the run together. */
	deadline_ms?: number;
}

type Waiter = { enter: () => void; gave_up: boolean; deadline: number };

/** The caller's error when its body ran past the deadline (it was abandoned). */
const RUN_TIMEOUT = 'region render timeout';
/** The caller's error when no slot came before the deadline (its body never ran). */
const WAIT_TIMEOUT = 'region render queue timeout';

export class ConcurrencyGate {
	#limit: number;
	#active = 0;
	#abandoned = 0;
	#wait: Waiter[] = [];

	constructor(max: number) {
		this.#limit = Math.max(1, max);
	}

	async run<T>(fn: () => Promise<T>, options: GateOptions = {}): Promise<T> {
		const { deadline_ms } = options;
		const deadline = deadline_ms === undefined ? Infinity : Date.now() + deadline_ms;
		await this.#enter(deadline);
		let body: Promise<T>;
		try {
			body = fn();
		} catch (error) {
			body = Promise.reject(error);
		}
		// the slot is this body's until it ends, or until it is abandoned at the deadline; it is given
		// back exactly once either way
		let holds = true;
		const end = () => {
			if (holds) {
				holds = false;
				this.#leave();
			} else this.#abandoned--;
		};
		body.then(end, end);
		if (deadline === Infinity) return body;
		return within(body, deadline - Date.now(), () => {
			if (!holds) return;
			holds = false;
			this.#abandoned++;
			this.#leave();
		});
	}

	/** Bodies running that someone waits on (the limit counts these). */
	get active(): number {
		return this.#active;
	}

	/** Bodies past their deadline still running: nobody waits on them, and they hold no slot. */
	get abandoned(): number {
		return this.#abandoned;
	}

	/** Calls waiting for a slot. */
	get waiting(): number {
		return this.#wait.length;
	}

	/** A slot: at once when one is free, else in turn (or the deadline passes first). */
	#enter(deadline: number): Promise<void> {
		if (this.#active < this.#limit) {
			this.#active++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waiter: Waiter = {
				gave_up: false,
				deadline,
				// (handed a slot by #leave, already counted)
				enter: () => {
					if (timer !== undefined) clearTimeout(timer);
					resolve();
				}
			};
			if (deadline !== Infinity)
				timer = setTimeout(() => {
					waiter.gave_up = true;
					// out of the queue now: with every slot held by bodies that never end, no `#leave`
					// would ever come to drop it, and the queue would grow by the request rate
					const at = this.#wait.indexOf(waiter);
					if (at !== -1) this.#wait.splice(at, 1);
					reject(new Error(WAIT_TIMEOUT));
				}, deadline - Date.now());
			this.#wait.push(waiter);
		});
	}

	/** A slot is given back: it goes straight to the next waiter still waiting, else it is free. (A
	 *  waiter whose deadline has come is passed over even before its timer runs: handed a slot, it
	 *  would only start a body nobody waits on.) */
	#leave(): void {
		const now = Date.now();
		let next = this.#wait.shift();
		while (next && (next.gave_up || next.deadline <= now)) next = this.#wait.shift();
		if (next) next.enter();
		else this.#active--;
	}
}

/** Whether `error` is a call's run timeout: its body ran past the deadline and was abandoned. */
export function is_run_timeout(error: unknown): boolean {
	return error instanceof Error && error.message === RUN_TIMEOUT;
}

/** `work`, or the run timeout after `ms` (`on_timeout` first; the timer cleared either way). */
function within<T>(work: Promise<T>, ms: number, on_timeout: () => void): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			on_timeout();
			reject(new Error(RUN_TIMEOUT));
		}, ms);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

/** Max concurrent region SSR renders per process (CPU amp under valid MAC). */
export const REGION_RENDER_CONCURRENCY = 4;
