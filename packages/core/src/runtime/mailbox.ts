/**
 * ONE REGION ELEMENT'S MAILBOX (#322): its events handled one at a time, in the order they came. A
 * connect, a schedule firing, an answer landing, a live tick, a fetch or a retry ending, a wake's
 * next step: each is a TURN of the element's mailbox, and no two turns of one element run at once.
 *
 *   const box = mailbox(life);              // the element's lifetime in the page owns it
 *   box.post((turn) => this.#apply(html, turn));
 *
 *   async #apply(html, turn) {
 *     ...                                   // its turn: no other event of the element runs here
 *     if ((await turn.wait(ready)) === STALE) return; // the element left the page meanwhile
 *     ...                                   // its turn again, after the events that came meanwhile
 *   }
 *
 * - A handler's turn lasts until it waits (`turn.wait`) or ends. Waiting lets the next event in; once
 *   what it waits for settles, the handler queues for a turn again, behind the events that came
 *   meanwhile. So two handlers on one element never see each other's half-done step. (A plain
 *   `await` in a handler keeps the turn across it: nothing else of the element runs until it is back.)
 * - An event that comes during a turn (a store write that notifies the element while it binds, a
 *   listener of an event the turn dispatched) runs after the turn, never inside it.
 * - The element leaving the page (the owner closing) closes it: the queued events are dropped, and a
 *   handler that waits gets `STALE` from its wait, at once: it stops at its next await. Anything
 *   posted after is dropped too. A move (out and back in one task) is no leaving: the owner stays.
 *
 * Speed: an event posted to an idle box runs at once, on the caller's stack, with nothing allocated
 * but its closure; the queue is made the first time an event has to wait for one.
 */
import { STALE, type Scope, type Stale } from '@ogygia/machine';
import { report_thrown } from '../report-thrown.ts';

/** The handler's side of its turn. */
export interface Turn {
	/** The element left the page: every wait from here is `STALE`. */
	readonly closed: boolean;
	/**
	 * Ends the turn while `work` settles, then waits for a turn again (in order, behind what came
	 * meanwhile): `work`'s value, or `STALE` once the element left (at once, without waiting for
	 * `work`). A rejection is thrown back in the handler's turn, unless the element left.
	 */
	wait<T>(work: PromiseLike<T> | T): Promise<T | Stale>;
}

export interface Mailbox extends Turn {
	/** Runs `handler` in its turn: now when the box is idle, else after what is ahead of it.
	 *  Dropped once the box closed. */
	post(handler: (turn: Turn) => unknown): void;
	/** {@link post}, and what the handler gave back: its value, or `STALE` when it was dropped. */
	ask<R>(handler: (turn: Turn) => R): Promise<Awaited<R> | Stale>;
}

/** A queued event (a handler to start) or a handler's return from its wait (to resume). */
type Job = { start: (turn: Turn) => unknown; resume: null } | { start: null; resume: () => void };

class Box implements Mailbox {
	/** A turn is on. */
	_busy = false;
	_closed = false;
	_queue: Job[] | null = null;
	/** The waits out, to end with `STALE` when the box closes. */
	_waiting: Set<(value: Stale) => void> | null = null;

	get closed(): boolean {
		return this._closed;
	}

	post(handler: (turn: Turn) => unknown): void {
		if (this._closed) return;
		if (this._busy) (this._queue ??= []).push({ start: handler, resume: null });
		else this._start(handler);
	}

	ask<R>(handler: (turn: Turn) => R): Promise<Awaited<R> | Stale> {
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
				return Promise.resolve(out).then(resolve as (value: Awaited<R>) => void, reject);
			});
			// (queued: dropped by the box closing first, its asker hears STALE)
			if (!started) (this._waiting ??= new Set()).add(stale);
		});
	}

	wait<T>(work: PromiseLike<T> | T): Promise<T | Stale> {
		this._end_turn();
		if (this._closed) return Promise.resolve(STALE);
		return new Promise<T | Stale>((resolve, reject) => {
			const waiting = (this._waiting ??= new Set());
			const stale = resolve as (value: Stale) => void;
			waiting.add(stale);
			const back = (go: () => void) => {
				if (!waiting.delete(stale)) return; // (the box closed: it already heard STALE)
				if (this._busy) (this._queue ??= []).push({ start: null, resume: go });
				else {
					this._busy = true;
					go();
				}
			};
			Promise.resolve(work).then(
				(value) => back(() => resolve(value)),
				(error: unknown) => back(() => reject(error))
			);
		});
	}

	/** A handler starts its turn; its turn ends when it waits or ends. One that throws throws to
	 *  whoever posted it, as a direct call would. */
	_start(handler: (turn: Turn) => unknown): void {
		this._busy = true;
		let out: unknown;
		try {
			out = handler(this);
		} catch (error) {
			this._end_turn();
			throw error;
		}
		if (out != null && typeof (out as PromiseLike<unknown>).then === 'function') {
			// (its failure stays as loud as a direct call's: the turn ends, and it is thrown on, unheard)
			(out as PromiseLike<unknown>).then(
				() => this._end_turn(),
				(error: unknown) => {
					this._end_turn();
					throw error;
				}
			);
		} else this._end_turn();
	}

	/** The turn on now ends: the next job, if any, gets its turn. */
	_end_turn(): void {
		if (!this._busy) return;
		this._busy = false;
		const next = this._queue?.shift();
		if (next === undefined) return;
		if (next.resume !== null) {
			this._busy = true;
			next.resume();
			return;
		}
		try {
			this._start(next.start);
		} catch (error) {
			// a queued handler that threw: nobody waits on its stack (the turn before it ended), so it
			// is the page's, as an event listener's throw is
			report_thrown(error);
		}
	}

	_close(): void {
		if (this._closed) return;
		this._closed = true;
		this._queue = null;
		const waiting = this._waiting;
		this._waiting = null;
		if (waiting !== null) for (const stale of waiting) stale(STALE);
	}
}

/** A box already closed: what an element holds before its first connect and after it left. */
export const CLOSED_BOX: Mailbox = /* @__PURE__ */ (() => {
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
