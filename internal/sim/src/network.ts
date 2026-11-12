/**
 * The network between the tabs and the servers: in memory, on the run's loop, and adversarial. Each
 * request and each response chunk is a loop task, so the seed decides when it arrives, and the
 * faults of the run decide what goes wrong on the way:
 *
 * - `delay`: each leg takes the seed's pick of latency (so answers can come back out of order);
 * - `drop`: the connection is lost (the fetch fails as a real one does: a `TypeError`);
 * - `duplicate`: a request reaches the server twice (a proxy's retry); the client sees one answer;
 * - `cut`: a response body stops partway (an aborted stream);
 * - `tamper`: a response body's bytes are changed on the way (what a broken proxy or an attacker in
 *   the middle does: signed payloads must be refused, never painted);
 * - `redirect`: a request to ogygia's region endpoint is sent to another origin, whose answer
 *   is HTML the page must never paint;
 * - `stall`: an answer is held 10 to 40 s before it starts coming, or, half the time, its body goes
 *   quiet that long after its first piece (a stuck connection, an overloaded origin): longer than a
 *   client's own deadline for it;
 * - `offline`: a tab's requests fail at once.
 *
 * A fault is on for a run when its class is in the run's swarm (search.ts picks a random subset per
 * run), and then fires with its probability.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Loop, Task } from './loop.ts';
import type { Rng } from './rng.ts';

export type FaultClass =
	| 'delay'
	| 'drop'
	| 'duplicate'
	| 'cut'
	| 'tamper'
	| 'reorder'
	| 'redirect'
	| 'stall';

/** The rest of the web, where a `redirect` fault sends a request (world.ts answers it). */
export const ELSEWHERE = 'https://elsewhere.test';

export interface NetworkOptions {
	loop: Loop;
	rng: Rng;
	/** The fault classes on for this run. */
	faults: ReadonlySet<FaultClass>;
	/** Each fault's chance when it is on (per request). */
	rates?: Partial<Record<FaultClass, number>>;
	/** The requests a `redirect` fault may send to another origin (default: ogygia's region
	 *  endpoint, whose HTML a page paints). */
	redirectable?: (url: URL) => boolean;
}

export type Handler = (request: Request) => Promise<Response>;

/** Hears a response's body end: all of it came (`whole`), or it broke off on the way. */
export type Ended = (whole: boolean, status: number) => void;

/** What the network saw, for the oracles and the trace. */
export interface Exchange {
	readonly id: number;
	readonly from: string;
	/** A server's hop: the document whose request the server was answering when it made it. */
	readonly for?: string;
	readonly method: string;
	readonly url: string;
	/** When it was sent (virtual ms). */
	readonly at: number;
	status: number | 'dropped' | 'offline' | 'aborted' | 'pending';
	cut: boolean;
	tampered: boolean;
	duplicated: boolean;
	/** Answered with a redirect to another origin (`ELSEWHERE`). */
	redirected: boolean;
	/** Its body broke off as its tab went offline (`status` stays the answer's). */
	lost?: boolean;
	/** Its answer was held 10 to 40 s on the way (a `stall`): its page may have given up on it. */
	stalled?: boolean;
	/** The build whose server gave the answer the client got (its {@link ANSWERED_BY} header). */
	build?: string;
	/** A batch of holes (`POST /__ogygia__`): the holes it asks for, by `answer_key` (world.ts). */
	holes?: readonly string[];
}

/** The header the front door puts on each answer: the build that answered it (a cached copy says
 *  it too). Read off the answer the client gets, not a duplicate's thrown away (seed 53). */
export const ANSWERED_BY = 'x-sim-build';

/** The document a server is answering, through all its async work: its own hops are on that
 *  document's behalf (a calm tab's reference load is calm all the way to a peer). */
const asked_by = new AsyncLocalStorage<string>();

/** The exchange a handler is answering now, through all its async work. */
const answering = new AsyncLocalStorage<Exchange>();

/** The exchange whose request is being answered now (the front door names what a batch asks). */
export function answering_now(): Exchange | undefined {
	return answering.getStore();
}

/** The client a server is answering: the visitor's address, or the reference load's. */
const client = new AsyncLocalStorage<string>();
const VISITOR_ADDRESS = '10.0.0.1';
const REFERENCE_ADDRESS = '10.0.0.2';

/** A body still coming this long after its head (a quiesce's budget), each piece within
 *  `LIVE_GAP_MS` of the one before, is a live answer (a live query, server-sent events). */
const LIVE_AFTER_MS = 30_000;
const LIVE_GAP_MS = 2_000;

/** The address of the client whose request a server is answering now (Kit's `getClientAddress`).
 *  An oracle's reference load is a client of its own: it shares no per-client budget (a rate
 *  limit) with the run's visitor, whose own traffic may have used it up (gen 78, seed 78013). */
export function client_address(): string {
	return client.getStore() ?? VISITOR_ADDRESS;
}

const RATES: Record<FaultClass, number> = {
	delay: 1,
	reorder: 0.3,
	drop: 0.03,
	duplicate: 0.05,
	cut: 0.03,
	tamper: 0.01,
	redirect: 0.3,
	stall: 0.02
};

export class Network {
	readonly #loop: Loop;
	readonly #rng: Rng;
	readonly #faults: ReadonlySet<FaultClass>;
	readonly #rates: Record<FaultClass, number>;
	readonly #offline = new Set<string>();
	#ids = 0;
	readonly exchanges: Exchange[] = [];

	constructor(options: NetworkOptions) {
		this.#loop = options.loop;
		this.#rng = options.rng.fork('net');
		this.#faults = options.faults;
		this.#rates = { ...RATES, ...options.rates };
		this.#redirectable = options.redirectable ?? ((url) => url.pathname.startsWith('/__ogygia__'));
	}

	readonly #redirectable: (url: URL) => boolean;

	/** Each exchange still on the wire (its request out, or its body still coming): how it ends
	 *  when its tab loses the network (`offline`), or its document is left (`left`). */
	readonly #on_wire = new Map<Exchange, (why: 'offline' | 'left') => void>();

	/** Documents their tab has left: nothing reaches them any more. */
	readonly #left = new Set<string>();

	/**
	 * Document `realm` is left (its tab moved on, or closed): a browser calls off its fetches as it
	 * unloads it, and its code never runs again, so what it has on the wire never reaches it, and
	 * nothing it sent is in flight any more (test/core.test.ts; gen 192, seed 11).
	 */
	leave(realm: string): void {
		this.#left.add(realm);
		for (const [ex, end] of this.#on_wire)
			if (ex.from === realm) {
				this.#on_wire.delete(ex);
				end('left');
			}
	}

	/**
	 * Takes `realm` off the network (or puts it back). What it has on the wire fails too, as when a
	 * device loses its connection: a request not yet answered fails to fetch, a body still coming
	 * (a page, a live stream) breaks off. (They used to go on arriving while the tab was offline.)
	 */
	offline(realm: string, off: boolean): void {
		if (off !== this.#offline.has(realm)) for (const told of this.#told) told(realm, !off);
		if (!off) {
			this.#offline.delete(realm);
			return;
		}
		this.#offline.add(realm);
		// (a Map deletes as it is walked: an entry gone is not visited)
		for (const [ex, fail] of this.#on_wire)
			if (ex.from === realm || ex.from.split('#')[0] === realm) {
				this.#on_wire.delete(ex);
				fail('offline');
			}
	}

	/** Whether `realm` (a tab) has the network: what its documents' `navigator.onLine` reads. */
	online(realm: string): boolean {
		return !this.#offline.has(realm);
	}

	/** Who hears a tab lose or get back the network (its documents: `offline`, `online`). */
	readonly #told: Array<(realm: string, online: boolean) => void> = [];

	/** Calls `told` each time a tab loses the network or gets it back. */
	tell(told: (realm: string, online: boolean) => void): void {
		this.#told.push(told);
	}

	/** Requests a server is still working on (sent, no answer yet): work in flight, however long it
	 *  takes (a hole that renders in 3 s). */
	unanswered(): number {
		for (const e of this.#open) if (e.status !== 'pending') this.#open.delete(e);
		return this.#open.size;
	}

	/** Exchanges that were pending when last looked at (`unanswered` prunes it). */
	readonly #open = new Set<Exchange>();

	/** Pieces of live answers on their way (`#deliver`). */
	readonly #live = new WeakSet<Task>();

	/** Whether work is on the wire: a request not answered yet, or a piece of a body on its way that
	 *  is not a live answer's (test/rest.node.test.ts). */
	busy(): boolean {
		return (
			this.unanswered() > 0 ||
			this.#loop.queued().some((t) => t.realm === 'net' && !this.#live.has(t))
		);
	}

	isOffline(realm: string): boolean {
		return this.#offline.has(realm);
	}

	/** Each calm tab's pace: ms added to every leg of its requests. */
	readonly #calm = new Map<string, number>();

	/** Spares `tab` (each of its documents) every fault but short delay: an oracle's reference
	 *  load. `pace` ms are added to each leg: a second reference at another speed shows what is time,
	 *  not state (a stamp of the render's moment), even when the run draws no delays. */
	calm(tab: string, pace = 0): void {
		this.#calm.set(tab, pace);
	}

	/** The pace of a calm request (its tab's, or for a server's hop, the calm tab's it serves), or
	 *  null when the faults may hit it. */
	#pace(realm: string, behalf: string): number | null {
		return this.#calm.get(realm.split('#')[0]) ?? this.#calm.get(behalf.split('#')[0]) ?? null;
	}

	#on(f: FaultClass): boolean {
		return this.#faults.has(f) && this.#rng.chance(this.#rates[f]);
	}

	/** One leg's latency: 1 ms with no delay faults; with them, mostly short and sometimes long. A
	 *  calm leg (`pace` not null) is never long, and is `pace` ms slower. */
	#latency(pace: number | null = null): number {
		if (!this.#faults.has('delay')) return 1 + (pace ?? 0);
		const long = this.#faults.has('reorder') && this.#rng.chance(this.#rates.reorder);
		const ms = long ? this.#rng.between(200, 3000) : this.#rng.between(5, 120);
		// (a calm leg is never a long one: two long legs on a reference load's peer hop passed the
		// peer's 5 s timeout, and the app rightly answered 504; gen 23, seed 23023. The same draws
		// either way, so every other leg of a run replays as it did)
		return (pace !== null && long ? 5 + (ms % 116) : ms) + (pace ?? 0);
	}

	/** Sends `request` from `realm` to `handler`; the answer comes when the loop says. `ended` hears
	 *  when its body has all come (`true`) or broke off on the way (`false`): a browser's resource
	 *  timing entry lands then. */
	send(realm: string, request: Request, handler: Handler, ended?: Ended): Promise<Response> {
		// (the document this request is for: its own, or, for a server's hop, the document whose
		// request the server was answering)
		const asked = asked_by.getStore();
		const behalf = asked ?? realm;
		const ex: Exchange = {
			id: ++this.#ids,
			from: realm,
			...(asked !== undefined && { for: asked }),
			method: request.method,
			url: request.url,
			at: this.#loop.now,
			status: 'pending',
			cut: false,
			tampered: false,
			duplicated: false,
			redirected: false
		};
		this.exchanges.push(ex);
		this.#open.add(ex);
		const loop = this.#loop;
		return new Promise<Response>((answered, failed) => {
			// (a document left hears nothing: a drop, a redirect or an error due after it never lands)
			const heard = () => !this.#left.has(realm);
			const resolve = (r: Response) => heard() && answered(r);
			const reject = (e: unknown) => heard() && failed(e);
			const fail = (why: string) => reject(new TypeError(`Failed to fetch (${why})`));
			// (offline is the tab's, whichever document it shows: `tab-2#3` is tab-2's)
			if (this.#offline.has(realm) || this.#offline.has(realm.split('#')[0])) {
				ex.status = 'offline';
				loop.add('net', `offline ${ex.id}`, 0, () => fail('offline'));
				return;
			}
			const signal = request.signal;
			// The server's end of the connection: its request is called off once the connection
			// closes (the client calls it off, its document is left or goes offline, the body is
			// cut or cancelled), as a Node server's request signal is (test/core.test.ts).
			const line = new AbortController();
			const hang_up = () => line.abort(new DOMException('The connection closed', 'AbortError'));
			signal?.addEventListener('abort', hang_up, { once: true });
			const aborted = () => {
				// (its page called it off before an answer came: nothing is on its way for it now)
				if (ex.status === 'pending') ex.status = 'aborted';
				reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
			};
			if (signal?.aborted) return aborted();
			signal?.addEventListener('abort', aborted, { once: true });
			// (a server's hop made while answering a calm tab is calm too: the reference load's peer
			// hop was dropped, and its page was the peer's 500; gen 12, seed 60)
			const pace = this.#pace(realm, behalf);
			const calm = pace !== null;
			if (!calm && this.#on('drop')) {
				ex.status = 'dropped';
				loop.add('net', `drop ${ex.id}`, this.#latency(), () => fail('connection lost'));
				return;
			}
			// an edge or proxy that sends a region's request to another origin (an open redirect, a
			// misrouted CDN): the page must never paint what comes back (INVARIANTS.md HOLE-TRUST)
			const target = new URL(request.url);
			if (!calm && this.#redirectable(target) && this.#on('redirect')) {
				ex.status = 302;
				ex.redirected = true;
				const location = ELSEWHERE + target.pathname + target.search;
				loop.add('net', `redirect ${ex.id}`, this.#latency(), () =>
					resolve(new Response(null, { status: 302, headers: { location } }))
				);
				return;
			}
			const dup = !calm && this.#on('duplicate');
			ex.duplicated = dup;
			const cut = !calm && this.#on('cut');
			const tamper = !calm && this.#on('tamper');
			// (drawn only in a run with stalls: every other run's draws stay as they were)
			const stall = !calm && this.#on('stall') ? this.#rng.between(10_000, 40_000) : 0;
			if (stall > 0) ex.stalled = true;
			// (half of them midway: the head on time, then the body quiet after its first piece)
			const midway = stall > 0 && this.#rng.chance(0.5) ? stall : 0;
			// (until its answer comes, its tab going offline fails it: `offline`)
			let lost = false;
			this.#on_wire.set(ex, (why) => {
				lost = true;
				hang_up();
				if (why === 'left') {
					ex.status = 'aborted';
					return;
				}
				ex.status = 'offline';
				loop.add('net', `offline ${ex.id}`, 0, () => fail(why));
			});
			signal?.addEventListener('abort', () => this.#on_wire.delete(ex), { once: true });
			loop.add(
				'net',
				`request ${ex.id} ${request.method} ${new URL(request.url).pathname}`,
				this.#latency(pace),
				() => {
					// (the duplicate is a connection of its own, closed once its answer is thrown away)
					const copy_line = dup ? new AbortController() : null;
					const copy =
						copy_line !== null ? new Request(request.clone(), { signal: copy_line.signal }) : null;
					const address = calm ? REFERENCE_ADDRESS : VISITOR_ADDRESS;
					const answer = (r: Request) =>
						answering.run(ex, () =>
							asked_by.run(behalf, () => client.run(address, () => handler(r)))
						);
					void answer(new Request(request, { signal: line.signal }))
						.then(async (response) => {
							// the duplicate is answered too, and its answer thrown away (as a proxy's retry)
							if (copy !== null)
								await answer(copy).then(
									(r) => {
										copy_line?.abort(new DOMException('The connection closed', 'AbortError'));
										return r.body?.cancel();
									},
									() => {}
								);
							if (!lost) ex.status = response.status;
							ex.build = response.headers.get(ANSWERED_BY) ?? undefined;
							const leg = this.#latency(pace) + stall - midway;
							loop.add('net', `response ${ex.id} ${response.status}`, leg, () => {
								if (signal?.aborted || lost) {
									hang_up();
									void response.body?.cancel();
									return;
								}
								this.#on_wire.delete(ex);
								resolve(
									this.#deliver(ex, response, cut, tamper, signal, pace, midway, ended, hang_up)
								);
							});
						})
						.catch((error: unknown) => {
							if (lost) return;
							this.#on_wire.delete(ex);
							ex.status = 500;
							loop.add('net', `error ${ex.id}`, this.#latency(pace), () =>
								fail(error instanceof Error ? error.message : String(error))
							);
						});
				}
			);
		});
	}

	/**
	 * The response as the client gets it: its body streamed as the server writes it, each piece a
	 * loop task (in order, each after the seed's latency), maybe cut or changed on the way. Streamed,
	 * not read whole first: a live answer (server-sent events, a long poll) never ends.
	 */
	#deliver(
		ex: Exchange,
		response: Response,
		cut: boolean,
		tamper: boolean,
		signal: AbortSignal | undefined,
		pace: number | null,
		midway = 0,
		heard?: Ended,
		hang_up: () => void = () => {}
	): Response {
		const headers = new Headers(response.headers);
		headers.delete('content-length');
		const init = { status: response.status, statusText: response.statusText, headers };
		const done = (whole: boolean) => heard?.(whole, response.status);
		const source = response.body?.getReader();
		if (source === undefined || response.status === 204 || response.status === 304) {
			done(true);
			return new Response(null, init);
		}
		// (only an answer made for this request is changed: a build's static files travel over TLS
		// from immutable URLs, and a broken byte in one is a broken script, which no app can defend;
		// a page or a region's answer is what the app must refuse when it does not verify)
		const asset = /javascript|css|font|image/.test(response.headers.get('content-type') ?? '');
		const loop = this.#loop;
		let to!: ReadableStreamDefaultController<Uint8Array>;
		let ended = false;
		const opened = loop.now;
		let last = loop.now;
		let piece = 0;
		const send = (label: string, deliver: () => void): void => {
			const quiet = piece === 1 ? midway : 0;
			const at = Math.max(last, loop.now + (piece === 0 ? 0 : this.#latency(pace)) + quiet);
			// (a body still coming LIVE_AFTER_MS after its head, each piece soon after the one before,
			// is a live answer: it never ends, and rest does not wait on it. A stalled body's quiet
			// piece is written with its head, so it is never one)
			const live = loop.now - opened >= LIVE_AFTER_MS && at - last <= LIVE_GAP_MS;
			last = at;
			const task = loop.add('net', `${label} ${ex.id}.${piece++}`, at - loop.now, () => {
				if (ended) return;
				try {
					deliver();
				} catch {
					// ok: the client cancelled the body; what is still on the way is dropped
				}
			});
			if (live) this.#live.add(task);
		};
		const stop = (why: string, offline = false): void => {
			if (offline) ex.lost = true;
			else ex.cut = true;
			send('cut', () => {
				to.error(new TypeError(`network error: ${why}`));
				ended = true;
				done(false);
			});
			hang_up();
			void source.cancel().catch(() => {});
		};
		const pump = async (): Promise<void> => {
			for (;;) {
				let read: ReadableStreamReadResult<Uint8Array>;
				try {
					read = await source.read();
				} catch {
					return stop('the server failed midway');
				}
				if (ended) return;
				if (read.done) {
					if (cut) return stop('the stream was cut');
					return send('end', () => {
						to.close();
						ended = true;
						done(true);
					});
				}
				let bytes = read.value;
				if (bytes.length === 0) continue;
				if (cut && this.#rng.chance(0.5)) return stop('the stream was cut');
				if (tamper && !asset && !ex.tampered) {
					ex.tampered = true;
					bytes = bytes.slice();
					const at = this.#rng.int(bytes.length);
					bytes[at] = bytes[at] ^ (1 + this.#rng.int(255));
				}
				// (a piece of the server's write may arrive in two: a reader must not assume whole writes)
				const halves =
					bytes.length > 1 && this.#rng.chance(0.3)
						? [bytes.subarray(0, this.#rng.between(1, bytes.length - 1)), null]
						: [bytes];
				if (halves[1] === null) halves[1] = bytes.subarray(halves[0]!.length);
				for (const h of halves) send('chunk', () => to.enqueue(h!));
			}
		};
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				to = controller;
			},
			cancel: () => {
				ended = true;
				hang_up();
				void source.cancel().catch(() => {});
			}
		});
		signal?.addEventListener(
			'abort',
			() => {
				if (ended) return;
				ended = true;
				try {
					to.error(signal.reason ?? new DOMException('aborted', 'AbortError'));
				} catch {
					// ok: already closed
				}
				void source.cancel().catch(() => {});
			},
			{ once: true }
		);
		// (a body still coming breaks off when its tab goes offline; its document left, the rest
		// never comes)
		this.#on_wire.set(ex, (why) => {
			if (ended) return;
			if (why === 'offline') return stop(why, true);
			ended = true;
			hang_up();
			void source.cancel().catch(() => {});
		});
		void pump();
		return new Response(stream, init);
	}
}
