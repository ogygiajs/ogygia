import { flights, type Flights } from './flights.ts';
import { mailbox, type Mailbox } from './mailbox.ts';
import { scope } from './scope.ts';
import { machine_error, report } from './messages.ts';
import { policy, under_policy, type Policy } from './policy.ts';
import { buggify } from './ports.ts';

/** Dev and rules builds (buggify points); folded out of any other (../rules-env.d.ts). */
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

export interface OutboxOptions<T> {
	/** Names the outbox in messages. Default `outbox`. */
	name?: string;
	/** One try at the work. Resolves once the receiver confirmed it applied it; throws (or rejects)
	 *  when it did not, and is tried again. `signal` aborts at the policy's deadline. */
	send: (item: T, signal: AbortSignal) => unknown;
	/** What names an item for the receiver to drop a second copy: a put of an id still out joins
	 *  it. An id that is not a string or a finite number (or that throws) names nothing: that item
	 *  is not sent, `giveUp` hears why, and its put resolves false. Default: none (each put is its
	 *  own send). */
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

function id_of(id: unknown): string | number {
	if (typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) return id;
	throw machine_error('machine_bad_option', {
		option: 'outbox id',
		value: String(id),
		rule: 'a string or a finite number'
	});
}

type Put<T> = { item: T; key: unknown };

class Box<T> implements Outbox<T> {
	_name: string;
	_send: (item: T, signal: AbortSignal) => unknown;
	_id: ((item: T) => string | number) | undefined;
	_retry: Policy;
	_give_up: ((item: T, error: unknown) => void) | undefined;
	_wait_until: ((work: Promise<unknown>) => void) | undefined;
	_flights: Flights<Put<T>, boolean, Pick<Put<T>, 'key'>>;
	_box: Mailbox | null;

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
		this._box = o.inOrder === true ? mailbox(scope()) : null;
		this._flights = flights.keyed<Put<T>>()({
			name: this._name,
			key: ['key'],
			ignore: { item: 'one send per id: a put of an id still out joins the send of the first' },
			keep: 0,
			run: (p) =>
				this._box === null
					? this._deliver(p.item)
					: (this._box.ask(() => this._deliver(p.item)) as Promise<boolean>)
		});
	}

	put(item: T): Promise<boolean> {
		let sent: Promise<boolean>;
		try {
			const p: Put<T> = { item, key: undefined };
			p.key = this._id === undefined ? p : id_of(this._id(item));
			sent = this._flights.get(p).then((done) => done === true);
		} catch (error) {
			this._gave_up(item, error);
			return Promise.resolve(false);
		}
		if (this._wait_until !== undefined) {
			try {
				this._wait_until(sent);
				// oxlint-disable-next-line ogygia/no-silent-failures -- a platform that refuses it: the send runs on in the process
			} catch {}
		}
		return sent;
	}

	async _deliver(item: T): Promise<boolean> {
		try {
			await under_policy(
				this._retry,
				RULES
					? async (signal) => {
							await this._send(item, signal);
							// (buggify: the receiver applied it and its reply was lost: the send is tried
							// again, and the receiver sees the same work twice)
							if (buggify.fires('outbox.reply-lost'))
								throw new Error('buggify: the reply was lost');
						}
					: (signal) => this._send(item, signal)
			);
			return true;
		} catch (error) {
			this._gave_up(item, error);
			return false;
		}
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
 *   ends. Without one, it runs on in the process, which stays alive for it (the waits between its
 *   tries too) until it is done or given up.
 * - `send` resolving is done, so it resolves only once the receiver confirmed it APPLIED the work
 *   (an HTTP send checks `ok`), and throws otherwise. The receiver applies first and records the id
 *   after, so a failed apply is tried again and a second copy of an applied one is dropped.
 * - A send that fails is tried again by `retry` (`policy.standard` by default). Its signal aborts at
 *   the policy's deadline, as does the try out; no try starts after it. Out of tries (or time),
 *   `giveUp` hears it once (by default the outbox prints `machine_outbox_gave_up`).
 * - Once a send is done or given up, nothing of it is kept: a later put of its id is a new send.
 * - With `id`, a put of an id whose send is still out (queued or trying) joins it: one send. An id
 *   that is not a string or a finite number (`undefined` from an item missing its id, `NaN`) would
 *   name every such item alike, so it names nothing: that item is not sent.
 * - With `inOrder`, one send at a time, in the order they were put: a send waits until the one
 *   before it is done or given up (its deadline counts from its own turn). With none ahead, it
 *   starts inside the put.
 */
export function outbox<T>(options: OutboxOptions<T>): Outbox<T> {
	return new Box<T>(options);
}
