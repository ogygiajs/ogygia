/**
 * Shared concurrency gate — client region fetches (SI-STORM) and server region SSR (M1).
 * Caps in-flight work; waiters queue FIFO. Does not cancel running work (see INVARIANTS.md).
 *
 * The one promise: never more than `limit` bodies running at once (#195).
 * - A freed slot is HANDED to the next waiter in the same step: it is never free in between, so a
 *   call arriving while the waiter resumes queues behind it instead of entering beside it.
 * - A body past `run_ms` stops being waited on (its caller gets the timeout), but it keeps its slot
 *   until it really ends: Svelte's `render()` cannot be cancelled, so a slot freed early let more
 *   renders run than the limit.
 * - A waiter that waited `wait_ms` for a slot gives up and never runs: with slots held by bodies
 *   that will not end (a hung upstream), the next call answers with its fallback instead of waiting
 *   forever.
 */

export interface GateOptions {
	/** Stop waiting for the body after this long (it keeps its slot until it ends). */
	run_ms?: number;
	/** Give up waiting for a slot after this long (the body never runs). */
	wait_ms?: number;
}

type Waiter = { enter: () => void; gave_up: boolean };

/** The caller's error when a body ran past `run_ms`. */
const RUN_TIMEOUT = 'region render timeout';
/** The caller's error when no slot came within `wait_ms`. */
const WAIT_TIMEOUT = 'region render queue timeout';

export class ConcurrencyGate {
	#limit: number;
	#active = 0;
	#wait: Waiter[] = [];

	constructor(max: number) {
		this.#limit = Math.max(1, max);
	}

	async run<T>(fn: () => Promise<T>, options: GateOptions = {}): Promise<T> {
		await this.#enter(options.wait_ms);
		// holds its slot from here until `fn` really ends, whatever the caller does meanwhile
		let body: Promise<T>;
		try {
			body = fn();
		} catch (error) {
			body = Promise.reject(error);
		}
		const done = body.then(
			() => this.#leave(),
			() => this.#leave()
		);
		void done;
		if (options.run_ms === undefined) return body;
		return within(body, options.run_ms, RUN_TIMEOUT);
	}

	get active(): number {
		return this.#active;
	}

	/** Calls waiting for a slot. */
	get waiting(): number {
		return this.#wait.length;
	}

	/** A slot: at once when one is free, else in turn (or the wait gives up). */
	#enter(wait_ms: number | undefined): Promise<void> {
		if (this.#active < this.#limit) {
			this.#active++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const waiter: Waiter = {
				gave_up: false,
				// (handed a slot by #leave, already counted)
				enter: () => {
					if (timer !== undefined) clearTimeout(timer);
					resolve();
				}
			};
			if (wait_ms !== undefined)
				timer = setTimeout(() => {
					waiter.gave_up = true;
					// out of the queue now: with every slot held by bodies that never end, no `#leave`
					// would ever come to drop it, and the queue would grow by the request rate
					const at = this.#wait.indexOf(waiter);
					if (at !== -1) this.#wait.splice(at, 1);
					reject(new Error(WAIT_TIMEOUT));
				}, wait_ms);
			this.#wait.push(waiter);
		});
	}

	/** A body ended: its slot goes straight to the next waiter still waiting, else it is free. */
	#leave(): void {
		let next = this.#wait.shift();
		while (next && next.gave_up) next = this.#wait.shift();
		if (next) next.enter();
		else this.#active--;
	}
}

/** `work`, or `message` as an error after `ms` (the timer cleared either way). */
function within<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
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
