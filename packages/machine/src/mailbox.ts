/**
 * A MAILBOX: one owner's events handled one at a time, in the order they came. Each event is a
 * TURN, and no two turns of one mailbox run at once. In ogygia each region element has one (#322):
 * a connect, a schedule firing, an answer landing, a live tick, a fetch or a retry ending, a wake's
 * next step.
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
 * - A handler's turn lasts until it waits (`turn.wait`) or ends. Waiting lets the next event in; once
 *   what it waits for settles, the handler queues for a turn again, behind the events that came
 *   meanwhile. So two handlers never see each other's half-done step. (A plain `await` in a handler
 *   keeps the turn across it: nothing else of the box runs until it is back.)
 * - An event that comes during a turn (a store write that notifies the owner while it binds, a
 *   listener of an event the turn dispatched) runs after the turn, never inside it.
 * - The owner closing closes it: the queued events are dropped, and a handler that waits gets
 *   `STALE` from its wait, at once: it stops at its next await. Anything posted after is dropped too.
 *
 * - Each handler is handed a turn of its own, so only the handler holding the turn ends it by
 *   waiting. A wait from anyone else (a second wait of a handler already waiting, a timer it left
 *   behind after it ended, `box.wait` from outside any turn) ends nobody's turn (#341).
 *
 * Speed: an event posted to an idle box runs at once, on the caller's stack, with nothing allocated
 * but its closure and its turn (one small object); the queue is made the first time an event has
 * to wait for one.
 */
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

/**
 * One handler's turn: what the handler is handed, and waits with. Each handler has its own, so the
 * box knows whose wait it is: only the one holding the turn ends it by waiting (#341).
 */
class Held implements Turn {
	_box: Box;
	/** Its handler ended: a wait of its own after that (a timer it left) takes no turn. */
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

/** A queued event (a handler to start) or a handler's return from its wait (to resume). */
type Job =
	| { start: (turn: Turn) => unknown; held: null; resume: null }
	| { start: null; held: Held; resume: () => void };

class Box implements Mailbox {
	/** The turn on now (null: idle). */
	_holder: Held | null = null;
	_closed = false;
	/** The jobs in line, from `_head` on (taken by index: a long queue is not shifted job by job). */
	_queue: Job[] | null = null;
	_head = 0;
	/** The loop that hands out turns is running (`_end_turn`). */
	_draining = false;
	/** The waits out, to end with `STALE` when the box closes. */
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
				// (the asker hears the handler's failure: the box's own chain never rejects)
				return Promise.resolve(out).then((value) => resolve(whole(value)), reject);
			});
			// (queued: dropped by the box closing first, its asker hears STALE)
			if (!started) (this._waiting ??= new Set()).add(stale);
		});
	}

	/** A wait from outside any turn (whoever holds the box): it ends no turn, and comes back with
	 *  none. */
	wait<T>(work: PromiseLike<T> | T): Promise<Fresh<T> | Stale> {
		return this._wait(null, work);
	}

	/** `held`'s wait: when it holds the turn, the turn ends while `work` settles, and it queues for
	 *  one again. A wait of nobody's turn (`null`, a handler that ended, a second wait of a handler
	 *  already waiting) ends no turn: it waits, and takes the turn only when its handler would
	 *  otherwise go on without one. */
	_wait<T>(held: Held | null, work: PromiseLike<T> | T): Promise<Fresh<T> | Stale> {
		if (held !== null && this._holder === held) this._end_turn();
		if (this._closed) return Promise.resolve(STALE);
		return new Promise<Fresh<T> | Stale>((resolve, reject) => {
			const waiting = (this._waiting ??= new Set());
			const stale = resolve as (value: Stale) => void;
			waiting.add(stale);
			const back = (go: () => void) => {
				// (the box closed: it already heard STALE)
				if (this._closed || !waiting.has(stale)) return;
				// (it stays among the waits until it runs: a box that closes while it is queued ends it
				// with STALE, #373)
				const resume = () => {
					waiting.delete(stale);
					go();
				};
				// (no turn to come back to: nobody's wait, its handler ended, or it holds the turn now)
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

	/** A handler starts its turn; its turn ends when it waits or ends. One that throws throws to
	 *  whoever posted it, as a direct call would. */
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
			// (its failure stays as loud as a direct call's: the turn ends, and it is thrown on, unheard)
			(out as PromiseLike<unknown>).then(
				() => this._ended(held),
				(error: unknown) => {
					this._ended(held);
					throw error;
				}
			);
		} else this._ended(held);
	}

	/** `held`'s handler ended: its turn too, if it holds it. */
	_ended(held: Held): void {
		held._ended = true;
		if (this._holder === held) this._end_turn();
	}

	/**
	 * The turn on now ends: the jobs queued get their turns, one after the other, until one holds
	 * on (it waits on a plain await) or none is left. One loop, on a flat stack: a sync handler that
	 * ends inside it only frees the turn, and the loop goes on with the next (#342).
	 */
	_end_turn(): void {
		this._holder = null;
		if (this._draining) return; // (the loop below is running: it takes the next)
		this._draining = true;
		try {
			while (this._holder === null) {
				const next = this._next();
				if (next === undefined) return;
				if (next.resume === null) {
					try {
						this._start(next.start);
					} catch (error) {
						// a queued handler that threw: nobody waits on its stack (the turn before it ended),
						// so it is the page's, as an event listener's throw is
						report_thrown('machine_mailbox_handler_failed', {}, error);
					}
					continue;
				}
				// (a handler that ended meanwhile takes no turn: it would never give it back)
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

	/** The next job in line, or none (the queue then goes). */
	_next(): Job | undefined {
		const queue = this._queue;
		if (queue === null) return undefined;
		if (this._head < queue.length) return queue[this._head++];
		this._queue = null;
		this._head = 0;
		return undefined;
	}

	/** `held` has its turn back: its other waits that came back meanwhile come back into it (a
	 *  handler on two waits at once would else hold the turn for the one still in the queue). */
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

/** The box of every owner already closed: every post dropped, every wait `STALE`. */
const CLOSED_BOX: Mailbox = /* @__PURE__ */ (() => {
	const box = new Box();
	box._closed = true;
	return box;
})();

/** A new mailbox, open while `owner` is. */
export function mailbox(owner: Scope): Mailbox {
	if (owner.closed) return CLOSED_BOX;
	const box = new Box();
	owner.defer(() => box._close());
	return box;
}
