/**
 * Work that must happen after the response, put in one place that keeps it alive, tries it again,
 * never sends it twice at once, and only calls it done when the other side said it applied it.
 *
 *   const thaws = outbox({
 *     name: 'thaw notices',
 *     send: (n: Notice, signal) => post_thaw(n, signal), // resolves: the peer applied it
 *     id: (n) => n.id,                                    // the peer drops a second copy
 *     retry: policy({ attempts: 4, backoff: [200, 1000, 5000], deadline: 30_000 }),
 *     giveUp: (n, error) => warn('thaw_undelivered', n.peer, error),
 *     waitUntil: (work) => platform.waitUntil(work)
 *   });
 *   thaws.put(notice); // returns at once, never throws
 *
 * - `put` starts the send at once and returns. The response never waits for it. Its promise
 *   (which never rejects) says how it ended: `true` once `send` resolved, `false` once it was given
 *   up; a caller whose next step needs the work done awaits it.
 * - `waitUntil` is handed each send: a serverless platform then keeps the instance alive until it
 *   ends. Without one, it runs on in the process.
 * - `send` resolving is done, so it resolves only once the receiver confirmed it APPLIED the work
 *   (an HTTP send checks `ok`), and throws otherwise. The receiver applies first and records the id
 *   after, so a failed apply is tried again and a second copy of an applied one is dropped.
 * - A send that fails is tried again by `retry` (`policy.standard` by default). Its signal aborts at
 *   the policy's deadline. Out of tries (or time), `giveUp` hears it once (by default the outbox
 *   prints `machine_outbox_gave_up`), and nothing of it is left behind.
 * - With `id`, a put of an id whose send is still out (queued or trying) joins it: one send.
 * - With `inOrder`, one send at a time, in the order they were put: a send waits until the one
 *   before it is done or given up (its deadline counts from its own turn).
 *
 * Each send is a flight (`flights()`, keyed by `id`, kept for nothing once it lands), and its tries
 * and waits are one scope's: the deadline closes it, which aborts the try out and ends the wait.
 */
import { flights, type Flights } from './flights.ts';
import { machine_error, report } from './messages.ts';
import { backoff_after, policy, type Policy } from './policy.ts';
import { scope } from './scope.ts';
import { STALE } from './stale.ts';

export interface OutboxOptions<T> {
	/** Names the outbox in messages. Default `outbox`. */
	name?: string;
	/** One try at the work. Resolves once the receiver confirmed it applied it; throws (or rejects)
	 *  when it did not, and is tried again. `signal` aborts at the policy's deadline. */
	send: (item: T, signal: AbortSignal) => unknown;
	/** What names an item for the receiver to drop a second copy: a put of an id still out joins
	 *  it. Default: none (each put is its own send). */
	id?: (item: T) => string | number;
	/** How a failed send is tried again. Default `policy.standard`. */
	retry?: Policy;
	/** One send at a time, in the order they were put. Default false: sends go out together. */
	inOrder?: boolean;
	/** Hears a send that ran out of tries or time, with the last error, once. Default: prints
	 *  `machine_outbox_gave_up`. */
	giveUp?: (item: T, error: unknown) => void;
	/** The platform's way to keep a request alive past its response (`waitUntil`): handed each send.
	 *  Default: none (the send runs on in the process). */
	waitUntil?: (work: Promise<unknown>) => void;
}

export interface Outbox<T> {
	/** Sends `item` (or joins its id's send still out). Returns at once and never throws; resolves
	 *  `true` once it was applied, `false` once it was given up, and never rejects. */
	put(item: T): Promise<boolean>;
}

/** One put: its item, and the key its send is shared under. */
type Put<T> = { item: T; key: unknown };

class Box<T> implements Outbox<T> {
	_name: string;
	_send: (item: T, signal: AbortSignal) => unknown;
	_id: ((item: T) => string | number) | undefined;
	_retry: Policy;
	_give_up: ((item: T, error: unknown) => void) | undefined;
	_wait_until: ((work: Promise<unknown>) => void) | undefined;
	_flights: Flights<Put<T>, boolean, unknown>;
	_in_order: boolean;
	/** In order: the last send put (it never rejects), and how many are put and not ended. */
	_tail: Promise<unknown> = Promise.resolve();
	_ahead = 0;

	constructor(o: OutboxOptions<T>) {
		if (typeof o.send !== 'function')
			throw machine_error('machine_bad_option', {
				option: 'send',
				value: typeof o.send,
				rule: 'a function'
			});
		this._name = o.name ?? 'outbox';
		this._send = o.send;
		this._id = o.id;
		this._retry = o.retry ?? policy.standard;
		this._give_up = o.giveUp;
		this._wait_until = o.waitUntil;
		this._in_order = o.inOrder === true;
		this._flights = flights({
			name: this._name,
			key: (p: Put<T>) => p.key,
			keep: 0,
			run: (p: Put<T>) => (this._in_order ? this._next(p.item) : this._deliver(p.item))
		});
	}

	/** In order: the send starts now when none is ahead of it, else once the last one put ends. */
	_next(item: T): Promise<boolean> {
		const mine =
			this._ahead === 0 ? this._deliver(item) : this._tail.then(() => this._deliver(item));
		this._ahead++;
		this._tail = mine.then(() => {
			this._ahead--;
		});
		return mine;
	}

	put(item: T): Promise<boolean> {
		let sent: Promise<boolean>;
		try {
			const p: Put<T> = { item, key: undefined };
			p.key = this._id === undefined ? p : this._id(item);
			// (never STALE: nothing drops a send, and no caller leaves it)
			sent = this._flights.get(p).then((done) => done === true);
		} catch (error) {
			// an `id` that threw: the item cannot be named, so it is not sent
			this._gave_up(item, error);
			return Promise.resolve(false);
		}
		if (this._wait_until !== undefined) {
			try {
				this._wait_until(sent);
			} catch {
				// ok: a platform that refuses it: the send runs on in the process
			}
		}
		return sent;
	}

	/** The tries of one send, within the deadline: true once one is done, false once given up. */
	async _deliver(item: T): Promise<boolean> {
		const retry = this._retry;
		const tries = scope();
		const started = Date.now();
		if (retry.deadline !== Infinity) tries.timeout(() => tries.close(), retry.deadline);
		let error: unknown = undefined;
		try {
			for (let n = 1; ; n++) {
				try {
					const answer = await tries.task((signal) => this._send(item, signal));
					if (answer !== STALE) return true;
				} catch (e) {
					error = e;
				}
				if (tries.closed) {
					error = late(retry.deadline, error);
					break;
				}
				if (n >= retry.attempts) break;
				const wait = backoff_after(retry, n);
				// (a wait that ends past the deadline is a try that would only be aborted)
				if (Date.now() - started + wait >= retry.deadline) break;
				const waited = await tries.task(() => new Promise<void>((r) => tries.timeout(r, wait)));
				if (waited === STALE) {
					error = late(retry.deadline, error);
					break;
				}
			}
		} finally {
			tries.close();
		}
		this._gave_up(item, error);
		return false;
	}

	_gave_up(item: T, error: unknown): void {
		if (this._give_up === undefined) {
			report('machine_outbox_gave_up', { name: this._name }, error);
			return;
		}
		try {
			this._give_up(item, error);
		} catch (thrown) {
			report('machine_outbox_gave_up', { name: this._name }, thrown);
		}
	}
}

/** What a send that ran out of time failed with: the deadline, and the try's own error first. */
function late(deadline: number, error: unknown): unknown {
	return new DOMException(
		`no try was done within ${deadline} ms` +
			(error === undefined ? '' : ` (last: ${String(error)})`),
		'TimeoutError'
	);
}

/** Work after the response, kept alive, tried again, sent once (see the module's comment). */
export function outbox<T>(options: OutboxOptions<T>): Outbox<T> {
	return new Box<T>(options);
}
