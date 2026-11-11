/**
 * THE WORLD: one seed drives all of it. Servers (instances of one or two builds, with clock skew),
 * visitors with browsers and tabs, the adversarial network between them, and a CDN in front of the
 * servers. Nothing in it reads real time or real chance: the host's own platform (where the servers
 * run) is the `server` realm's simulated one for the length of the run.
 */
import { join } from 'node:path';
import { Browsers, type Tab, type Visitor } from './browser.ts';
import {
	completion_on_the_loop,
	history_by_document,
	inert_custom_elements,
	inert_parsed_documents,
	whole_text_runs
} from './happy.ts';
import { Cdn } from './cdn.ts';
import { Loop } from './loop.ts';
import { use_v8_modules } from './modules.ts';
import { ELSEWHERE, Network, type FaultClass } from './network.ts';
import { install, platform } from './platform.ts';
import { rng, type Rng } from './rng.ts';
import { current_server, start_server, type Build, type ServerInstance } from './server.ts';

export const ORIGIN = 'https://app.test';

/** The attribute on every element of HTML another origin answers (`no_foreign_html` looks for it). */
export const FOREIGN_MARK = 'data-sim-foreign';

export interface WorldOptions {
	seed: number;
	/** The builds a deploy moves between: the first is live at the start. */
	builds: readonly Build[];
	/** Server instances per build (each its own module graph). Default 1. */
	instances?: number;
	/** Most ms a server's clock is off. Default 0. */
	skew?: number;
	/** The fault classes on for this run. */
	faults?: ReadonlySet<FaultClass>;
	/** Each fault's chance when it is on (a test may make one sure). */
	rates?: Partial<Record<FaultClass, number>>;
	/** Virtual ms past which nothing runs. */
	horizon?: number;
	/** Where builds are copied to (one copy per instance). */
	scratch?: string;
	/** Files the app's own test harness serves (a Playwright `page.route`), by path: answered at
	 *  the front door as an empty file of their kind, as the rest of the web is. */
	supplied?: readonly string[];
}

export class World {
	readonly seed: number;
	readonly rng: Rng;
	readonly loop: Loop;
	readonly network: Network;
	readonly cdn: Cdn;
	readonly browsers: Browsers;
	/** Live instances by build id. */
	readonly servers = new Map<string, ServerInstance[]>();
	/** Errors no page or server caught, as the host process heard them. */
	readonly uncaught: string[] = [];
	/** The build new requests go to (a deploy moves it). */
	live: string;
	readonly #o: WorldOptions;
	#restore: (() => void) | null = null;

	private constructor(o: WorldOptions) {
		this.#o = o;
		this.seed = o.seed;
		this.rng = rng(o.seed);
		this.loop = new Loop(this.rng, { horizon: o.horizon });
		this.network = new Network({
			loop: this.loop,
			rng: this.rng,
			faults: o.faults ?? new Set(),
			rates: o.rates
		});
		this.cdn = new Cdn(this.loop);
		this.browsers = new Browsers({
			loop: this.loop,
			rng: this.rng,
			network: this.network,
			route: (request) => this.#route(request),
			origin: ORIGIN
		});
		this.live = o.builds[0].id;
	}

	/** Makes a world from `o` and starts its servers. */
	static async make(o: WorldOptions): Promise<World> {
		use_v8_modules();
		inert_parsed_documents();
		inert_custom_elements();
		whole_text_runs();
		history_by_document();
		const w = new World(o);
		completion_on_the_loop(w.loop);
		const host = platform({
			name: 'server',
			loop: w.loop,
			rng: w.rng,
			skew: () => current_server.getStore()?.skew ?? 0,
			node: true
		});
		const restore = install(globalThis, host);
		// a server's own `fetch` (Kit reads a prerendered remote answer from its own origin) goes
		// through the world too, like a tab's: never the real network
		const real_fetch = globalThis.fetch;
		globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			const from = current_server.getStore()?.name ?? 'server';
			return w.network.send(from, request, (r) => w.#route(r));
		};
		// a page's (or a server's) uncaught error reaches the host process: it is the run's finding,
		// not the simulator's crash
		// (an error from a tab is of the tab's realm: not `instanceof` the host's Error)
		const uncaught = (error: unknown) => {
			const stack = (error as { stack?: unknown } | null)?.stack;
			w.uncaught.push(
				typeof stack === 'string' ? stack.split('\n').slice(0, 6).join('\n') : String(error)
			);
		};
		process.on('unhandledRejection', uncaught);
		process.on('uncaughtException', uncaught);
		w.#restore = () => {
			process.off('unhandledRejection', uncaught);
			process.off('uncaughtException', uncaught);
			globalThis.fetch = real_fetch;
			restore();
		};
		await w.deploy(o.builds[0]);
		return w;
	}

	/** Starts the instances of `build` and sends new requests to it (a deploy, or the first start). */
	async deploy(build: Build): Promise<void> {
		if (!this.servers.has(build.id)) {
			const r = this.rng.fork(`servers ${build.id}`);
			// (beside the app's output, so the copies resolve the app's own dependencies)
			const scratch = this.#o.scratch ?? join(build.output, '..', 'sim');
			const list: ServerInstance[] = [];
			for (let i = 0; i < (this.#o.instances ?? 1); i++) {
				const skew = this.#o.skew ? r.between(-this.#o.skew, this.#o.skew) : 0;
				list.push(await start_server(`server-${i}`, build, scratch, skew));
			}
			this.servers.set(build.id, list);
		}
		this.live = build.id;
	}

	/** A request at the front door: the CDN, then the live build's instance the seed picks. */
	#route(request: Request): Promise<Response> {
		// another host (a page's third-party script or stylesheet): the rest of the web, which
		// answers with an empty file of the kind asked for; the app is not tested against it
		const url = new URL(request.url);
		// (where a `redirect` fault sends a region's request: HTML marked as foreign, open to any
		// origin, so only the page's own check stands between it and the screen; `no_foreign_html`)
		if (url.origin === ELSEWHERE)
			return Promise.resolve(
				new Response(`<p ${FOREIGN_MARK}="">painted from ${url.href}</p>`, {
					headers: { 'content-type': 'text/html', 'access-control-allow-origin': '*' }
				})
			);
		if (url.origin !== ORIGIN || this.#o.supplied?.includes(url.pathname)) {
			const type = url.pathname.endsWith('.css')
				? 'text/css'
				: /\.m?js$/.test(url.pathname)
					? 'text/javascript'
					: 'text/plain';
			return Promise.resolve(new Response('', { headers: { 'content-type': type } }));
		}
		return this.cdn.fetch(request, (r) => {
			const list = this.servers.get(this.live)!;
			return list[this.rng.int(list.length)].handle(r);
		});
	}

	visitor(name: string): Visitor {
		return this.browsers.visitor(name);
	}

	tab(v: Visitor): Tab {
		return this.browsers.open(v);
	}

	/** Navigates `tab` and runs the loop until the page has loaded and gone quiet (or `budget` ms). */
	async go(
		tab: Tab,
		how: 'goto' | 'back' | 'forward' | 'reload',
		path = '/',
		budget = 30_000
	): Promise<void> {
		let done = false;
		void this.browsers.navigate(tab, how, path).then(() => (done = true));
		const end = this.loop.now + budget;
		await this.loop.settle();
		while (!done && this.loop.now < end) if (!(await this.loop.step())) break;
		await this.quiesce(Math.max(0, end - this.loop.now));
	}

	/**
	 * Runs the loop until the world is at rest: nothing on the network and nothing due within `gap`
	 * ms (a live region's next tick may be), or `budget` ms have passed. (A slow leg takes up to 3 s:
	 * a gap alone once called a page at rest with its island's chunk on the wire, seed 3.) Rest is
	 * judged on the loop alone: every page's
	 * pending work is a loop task (its timers, its fetches on the network) or held real work that
	 * `settle()` waits out. (Not happy-dom's `waitUntilComplete`: it resolves on a real 1 ms timer,
	 * so whether a page was "complete" would depend on the host's speed, and the run would not
	 * replay.)
	 */
	async quiesce(budget = 30_000, gap = 2_000): Promise<void> {
		const end = this.loop.now + budget;
		for (;;) {
			await this.loop.settle();
			const next = this.loop.next_at;
			// (something on the wire is work in flight, however slow the leg: never rest)
			const quiet = this.loop.next_of('net') === Infinity;
			if (next > end || (quiet && next > this.loop.now + gap) || next > this.loop.horizon) return;
			await this.loop.step();
		}
	}

	/** Ends the world: browsers closed, the host's platform given back. */
	async end(): Promise<void> {
		// (closing a page waits for its documents to finish: on real time now, the loop has stopped)
		completion_on_the_loop(null);
		try {
			await this.browsers.end();
		} finally {
			this.#restore?.();
			this.#restore = null;
			for (const list of this.servers.values()) for (const s of list) s.stop();
		}
	}
}
