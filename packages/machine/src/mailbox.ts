import { report_thrown } from './messages.ts';
import type { Scope } from './scope.ts';
import { STALE, whole, type Fresh, type Stale } from './stale.ts';

/** The handler's side of its turn. */
export interface Turn {
	/** The owner closed: every wait from here is `STALE`. */
	readonly closed: boolean;
	/**
	 * Ends the turn while `work` settles, then waits for a turn again (in order, behind what came
	 * meanwhile): `work`'s value, or `STALE` once the owner closed (at once, without waiting for
	 * `work`). A rejection is thrown back in the handler's turn, unless the owner closed. `work`
	 * that gives `STALE`, or an array with `STALE` in it (a `Promise.all` with a stale part), gives
	 * `STALE`: if anything it waited on is stale, the whole wait is.
	 */
	wait<T>(work: PromiseLike<T> | T): Promise<Fresh<T> | Stale>;
}

export interface Mailbox extends Turn {
	/** Runs `handler` in its turn: now when the box is idle, else after what is ahead of it.
	 *  Dropped once the box closed. A handler that throws when it runs at once throws to the
	 *  poster; one that ran later is reported (`machine_mailbox_handler_failed`). */
	post(handler: (turn: Turn) => unknown): void;
	/** {@link post}, and what the handler gave back: its value, or `STALE` when it was dropped (or
	 *  it gave `STALE`, or an array with `STALE` in it). */
	ask<R>(handler: (turn: Turn) => R): Promise<Fresh<Awaited<R>> | Stale>;
	/** A wait from outside any turn: `work`'s value, or `STALE` once the owner closed. It ends
	 *  nobody's turn and takes none. */
	wait<T>(work: PromiseLike<T> | T): Promise<Fresh<T> | Stale>;
}

class Held implements Turn {
	_box: Box;
	_ended = false;

	constructor(box: Box) {
		this._box = box;
	}

	get closed(): boolean {
		return this._box._closed;
	}

	wait<T>(work: PromiseLike<T> | T): Promise<Fresh<T> | Stale> {
		return this._box._wait(this, work);
	}
}

type Job =
	| { start: (turn: Turn) => unknown; held: null; resume: null }
	| { start: null; held: Held; resume: () => void };

class Box implements Mailbox {
	_holder: Held | null = null;
	_closed = false;
	_queue: Job[] | null = null;
	_head = 0;
	_draining = false;
	_waiting: Set<(value: Stale) => void> | null = null;

	get closed(): boolean {
		return this._closed;
	}

	post(handler: (turn: Turn) => unknown): void {
		if (this._closed) return;
		if (this._holder !== null)
			(this._queue ??= []).push({ start: handler, held: null, resume: null });
		else this._start(handler);
	}

	ask<R>(handler: (turn: Turn) => R): Promise<Fresh<Awaited<R>> | Stale> {
		return new Promise((resolve, reject) => {
			if (this._closed) return resolve(STALE);
			const stale = resolve as (value: Stale) => void;
			let started = false;
			this.post((turn) => {
				started = true;
				this._waiting?.delete(stale);
				let out: R;
				try {
					out = handler(turn);
				} catch (error) {
					return reject(error);
				}
				return Promise.resolve(out).then((value) => resolve(whole(value)), reject);
			});
			if (!started) (this._waiting ??= new Set()).add(stale);
		});
	}

	wait<T>(work: PromiseLike<T> | T): Promise<Fresh<T> | Stale> {
		return this._wait(null, work);
	}

	_wait<T>(held: Held | null, work: PromiseLike<T> | T): Promise<Fresh<T> | Stale> {
		if (held !== null && this._holder === held) this._end_turn();
		if (this._closed) return Promise.resolve(STALE);
		return new Promise<Fresh<T> | Stale>((resolve, reject) => {
			const waiting = (this._waiting ??= new Set());
			const stale = resolve as (value: Stale) => void;
			waiting.add(stale);
			const back = (go: () => void) => {
				if (this._closed || !waiting.has(stale)) return;
				const resume = () => {
					// @why a box that closes while this return is queued ends it with STALE (test: test/mailbox.test.ts › a wait whose work settled while another handler held the turn hears STALE when the box closes)
					waiting.delete(stale);
					go();
				};
				if (held === null || held._ended || this._holder === held) resume();
				else if (this._holder !== null) (this._queue ??= []).push({ start: null, held, resume });
				else {
					this._holder = held;
					resume();
				}
			};
			Promise.resolve(work).then(
				(value) => back(() => resolve(whole(value as T))),
				(error: unknown) => back(() => reject(error))
			);
		});
	}

	_start(handler: (turn: Turn) => unknown): void {
		const held = new Held(this);
		this._holder = held;
		let out: unknown;
		try {
			out = handler(held);
		} catch (error) {
			this._ended(held);
			throw error;
		}
		if (out != null && typeof (out as PromiseLike<unknown>).then === 'function') {
			(out as PromiseLike<unknown>).then(
				() => this._ended(held),
				(error: unknown) => {
					this._ended(held);
					throw error;
				}
			);
		} else this._ended(held);
	}

	_ended(held: Held): void {
		held._ended = true;
		if (this._holder === held) this._end_turn();
	}

	_end_turn(): void {
		this._holder = null;
		// @why one loop hands out turns, on a flat stack: a sync handler that ends inside it only frees the turn (test: test/mailbox.test.ts › runs a long run of sync events queued in one turn, on a flat stack (#342))
		if (this._draining) return;
		this._draining = true;
		try {
			while (this._holder === null) {
				const next = this._next();
				if (next === undefined) return;
				if (next.resume === null) {
					try {
						this._start(next.start);
					} catch (error) {
						report_thrown('machine_mailbox_handler_failed', {}, error);
					}
					continue;
				}
				if (next.held._ended) {
					next.resume();
					continue;
				}
				this._holder = next.held;
				next.resume();
				this._back_in(next.held);
			}
		} finally {
			this._draining = false;
		}
	}

	_next(): Job | undefined {
		const queue = this._queue;
		if (queue === null) return undefined;
		if (this._head < queue.length) return queue[this._head++];
		this._queue = null;
		this._head = 0;
		return undefined;
	}

	_back_in(held: Held): void {
		const queue = this._queue;
		if (queue === null) return;
		let kept = this._head;
		for (let i = this._head; i < queue.length; i++) {
			const job = queue[i];
			if (job.held === held) job.resume();
			else queue[kept++] = job;
		}
		queue.length = kept;
	}

	_close(): void {
		if (this._closed) return;
		this._closed = true;
		this._queue = null;
		this._head = 0;
		const waiting = this._waiting;
		this._waiting = null;
		if (waiting !== null) for (const stale of waiting) stale(STALE);
	}
}

const CLOSED_BOX: Mailbox = /* @__PURE__ */ (() => {
	const box = new Box();
	box._closed = true;
	return box;
})();

/**
 * A new mailbox, open while `owner` is: one owner's events handled one at a time, in the order
 * they came. Each event is a TURN, and no two turns of one mailbox run at once. In ogygia each
 * region element has one (#322): a connect, a schedule firing, an answer landing, a live tick, a
 * fetch or a retry ending, a wake's next step.
 *
 *   const box = mailbox(life);              // the owner's lifetime owns it
 *   box.post((turn) => apply(html, turn));
 *
 *   async function apply(html, turn) {
 *     ...                                   // its turn: no other event of the box runs here
 *     if ((await turn.wait(ready)) === STALE) return; // the owner closed meanwhile
 *     ...                                   // its turn again, after the events that came meanwhile
 *   }
 *
 * - An event posted to an idle box runs at once, on the caller's stack.
 * - A handler's turn lasts until it waits (`turn.wait`) or ends. Waiting lets the next event in; once
 *   what it waits for settles, the handler queues for a turn again, behind the events that came
 *   meanwhile. So two handlers never see each other's half-done step. (A plain `await` in a handler
 *   keeps the turn across it: nothing else of the box runs until it is back.)
 * - An event that comes during a turn (a store write that notifies the owner while it binds, a
 *   listener of an event the turn dispatched) runs after the turn, never inside it.
 * - The owner closing closes it: the queued events are dropped, and a handler that waits gets
 *   `STALE` from its wait, at once: it stops at its next await. Anything posted after is dropped
 *   too. An owner already closed gets a closed box.
 * - Each handler is handed a turn of its own, so only the handler holding the turn ends it by
 *   waiting. A wait from anyone else (a second wait of a handler already waiting, a timer it left
 *   behind after it ended, `box.wait` from outside any turn) ends nobody's turn (#341).
 * - A queued handler that throws is reported (`machine_mailbox_handler_failed`), as an event
 *   listener's throw is, and the box goes on. One posted (not asked) that rejects later is an
 *   unhandled rejection, as a direct call's would be.
 */
export function mailbox(owner: Scope): Mailbox {
	if (owner.closed) return CLOSED_BOX;
	const box = new Box();
	owner.defer(() => box._close());
	return box;
}
