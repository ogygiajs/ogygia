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
 * - `offline`: a tab's requests fail at once.
 *
 * A fault is on for a run when its class is in the run's swarm (search.ts picks a random subset per
 * run), and then fires with its probability.
 */
import type { Loop } from './loop.ts';
import type { Rng } from './rng.ts';

export type FaultClass = 'delay' | 'drop' | 'duplicate' | 'cut' | 'tamper' | 'reorder' | 'redirect';

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

/** What the network saw, for the oracles and the trace. */
export interface Exchange {
	readonly id: number;
	readonly from: string;
	readonly method: string;
	readonly url: string;
	status: number | 'dropped' | 'offline' | 'aborted' | 'pending';
	cut: boolean;
	tampered: boolean;
	duplicated: boolean;
	/** Answered with a redirect to another origin (`ELSEWHERE`). */
	redirected: boolean;
	/** Its body broke off as its tab went offline (`status` stays the answer's). */
	lost?: boolean;
	/** The build whose server gave the answer the client got (its {@link ANSWERED_BY} header). */
	build?: string;
}

/** The header the front door puts on each answer: the build that answered it (a cached copy says
 *  it too). Read off the answer the client gets, not a duplicate's thrown away (seed 53). */
export const ANSWERED_BY = 'x-sim-build';

const RATES: Record<FaultClass, number> = {
	delay: 1,
	reorder: 0.3,
	drop: 0.03,
	duplicate: 0.05,
	cut: 0.03,
	tamper: 0.01,
	redirect: 0.3
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

	/** Each exchange still on the wire (its request out, or its body still coming): how it fails
	 *  when its tab loses the network. */
	readonly #on_wire = new Map<Exchange, (why: string) => void>();

	/**
	 * Takes `realm` off the network (or puts it back). What it has on the wire fails too, as when a
	 * device loses its connection: a request not yet answered fails to fetch, a body still coming
	 * (a page, a live stream) breaks off. (They used to go on arriving while the tab was offline.)
	 */
	offline(realm: string, off: boolean): void {
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

	/** Requests a server is still working on (sent, no answer yet): work in flight, however long it
	 *  takes (a hole that renders in 3 s). */
	unanswered(): number {
		for (const e of this.#open) if (e.status !== 'pending') this.#open.delete(e);
		return this.#open.size;
	}

	/** Exchanges that were pending when last looked at (`unanswered` prunes it). */
	readonly #open = new Set<Exchange>();

	isOffline(realm: string): boolean {
		return this.#offline.has(realm);
	}

	readonly #calm = new Set<string>();

	/** Spares `tab` (each of its documents) every fault but delay: an oracle's reference load. */
	calm(tab: string): void {
		this.#calm.add(tab);
	}

	#on(f: FaultClass): boolean {
		return this.#faults.has(f) && this.#rng.chance(this.#rates[f]);
	}

	/** One leg's latency: 1 ms with no delay faults; with them, mostly short and sometimes long. */
	#latency(): number {
		if (!this.#faults.has('delay')) return 1;
		const long = this.#faults.has('reorder') && this.#rng.chance(this.#rates.reorder);
		return long ? this.#rng.between(200, 3000) : this.#rng.between(5, 120);
	}

	/** Sends `request` from `realm` to `handler`; the answer comes when the loop says. */
	send(realm: string, request: Request, handler: Handler): Promise<Response> {
		const ex: Exchange = {
			id: ++this.#ids,
			from: realm,
			method: request.method,
			url: request.url,
			status: 'pending',
			cut: false,
			tampered: false,
			duplicated: false,
			redirected: false
		};
		this.exchanges.push(ex);
		this.#open.add(ex);
		const loop = this.#loop;
		return new Promise<Response>((resolve, reject) => {
			const fail = (why: string) => reject(new TypeError(`Failed to fetch (${why})`));
			// (offline is the tab's, whichever document it shows: `tab-2#3` is tab-2's)
			if (this.#offline.has(realm) || this.#offline.has(realm.split('#')[0])) {
				ex.status = 'offline';
				loop.add('net', `offline ${ex.id}`, 0, () => fail('offline'));
				return;
			}
			const signal = request.signal;
			const aborted = () => {
				// (its page called it off before an answer came: nothing is on its way for it now)
				if (ex.status === 'pending') ex.status = 'aborted';
				reject(signal.reason ?? new DOMException('aborted', 'AbortError'));
			};
			if (signal?.aborted) return aborted();
			signal?.addEventListener('abort', aborted, { once: true });
			const calm = this.#calm.has(realm.split('#')[0]);
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
			// (until its answer comes, its tab going offline fails it: `offline`)
			let lost = false;
			this.#on_wire.set(ex, (why) => {
				lost = true;
				ex.status = 'offline';
				loop.add('net', `offline ${ex.id}`, 0, () => fail(why));
			});
			signal?.addEventListener('abort', () => this.#on_wire.delete(ex), { once: true });
			loop.add(
				'net',
				`request ${ex.id} ${request.method} ${new URL(request.url).pathname}`,
				this.#latency(),
				() => {
					const copy = dup ? request.clone() : null;
					void handler(request)
						.then(async (response) => {
							// the duplicate is answered too, and its answer thrown away (as a proxy's retry)
							if (copy !== null)
								await handler(copy).then(
									(r) => r.body?.cancel(),
									() => {}
								);
							if (!lost) ex.status = response.status;
							ex.build = response.headers.get(ANSWERED_BY) ?? undefined;
							loop.add('net', `response ${ex.id} ${response.status}`, this.#latency(), () => {
								if (signal?.aborted || lost) {
									void response.body?.cancel();
									return;
								}
								this.#on_wire.delete(ex);
								resolve(this.#deliver(ex, response, cut, tamper, signal));
							});
						})
						.catch((error: unknown) => {
							if (lost) return;
							this.#on_wire.delete(ex);
							ex.status = 500;
							loop.add('net', `error ${ex.id}`, this.#latency(), () =>
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
		signal: AbortSignal | undefined
	): Response {
		const headers = new Headers(response.headers);
		headers.delete('content-length');
		const init = { status: response.status, statusText: response.statusText, headers };
		const source = response.body?.getReader();
		if (source === undefined || response.status === 204 || response.status === 304)
			return new Response(null, init);
		// (only an answer made for this request is changed: a build's static files travel over TLS
		// from immutable URLs, and a broken byte in one is a broken script, which no app can defend;
		// a page or a region's answer is what the app must refuse when it does not verify)
		const asset = /javascript|css|font|image/.test(response.headers.get('content-type') ?? '');
		const loop = this.#loop;
		let to!: ReadableStreamDefaultController<Uint8Array>;
		let ended = false;
		let last = loop.now;
		let piece = 0;
		const send = (label: string, deliver: () => void): void => {
			const at = Math.max(last, loop.now + (piece === 0 ? 0 : this.#latency()));
			last = at;
			loop.add('net', `${label} ${ex.id}.${piece++}`, at - loop.now, () => {
				if (ended) return;
				try {
					deliver();
				} catch {
					// ok: the client cancelled the body; what is still on the way is dropped
				}
			});
		};
		const stop = (why: string, offline = false): void => {
			if (offline) ex.lost = true;
			else ex.cut = true;
			send('cut', () => {
				to.error(new TypeError(`network error: ${why}`));
				ended = true;
			});
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
		// (a body still coming breaks off when its tab goes offline)
		this.#on_wire.set(ex, (why) => {
			if (!ended) stop(why, true);
		});
		void pump();
		return new Response(stream, init);
	}
}
