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
	documents_by_namespace,
	history_by_document,
	inert_custom_elements,
	inert_parsed_documents,
	modules_in_order,
	whole_text_runs
} from './happy.ts';
import { Cdn } from './cdn.ts';
import { Loop } from './loop.ts';
import { use_v8_modules } from './modules.ts';
import { ANSWERED_BY, ELSEWHERE, Network, type FaultClass } from './network.ts';
import { install, platform } from './platform.ts';
import { rng, type Rng } from './rng.ts';
import {
	current_server,
	own_env,
	own_symbols,
	start_server,
	type Build,
	type ServerInstance
} from './server.ts';

export const ORIGIN = 'https://app.test';

/** The attribute on every element of HTML another origin answers (`no_foreign_html` looks for it). */
export const FOREIGN_MARK = 'data-sim-foreign';

/** Whether a request of a tab's is for a page (its Kit data too): not a build's file or Kit's
 *  remote functions (`/_app/`), not a region's answer (ogygia's endpoint, `/__ogygia__`, and
 *  federation's, `/og/`: a peer frame's hole asked after a deploy is not the page's build; gen 54,
 *  seed 54024). */
export function is_page_path(path: string): boolean {
	return !path.startsWith('/_app/') && !path.startsWith('/__ogygia__') && !path.startsWith('/og/');
}

/** A request's key among a document's answers: its path and query, less what a render signs anew
 *  each time (a hole's expiry and signature), so a fresh load's same request is the same key. */
export function answer_key(url: URL): string {
	const q = new URLSearchParams(url.search);
	q.delete('exp');
	q.delete('sig');
	const s = q.toString();
	return s ? `${url.pathname}?${s}` : url.pathname;
}

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
	/** How a deploy goes out (`World.deploy_next`). Default: at once, old files gone, no purge. */
	rollover?: Rollover;
	/** BUGGIFY (@ogygia/machine `buggify`, in rules builds): each point's chance to be on for this
	 *  run (a swarm: a run tries some rare branches hard and leaves the rest alone), and an on
	 *  point's chance to fire at each call. Default: off. */
	buggify?: { readonly on: number; readonly fires: number };
	/** The app's `OGYGIA_SECRET`, the same for every build (a stable signing key). Unset, each build
	 *  signs with its own key, and a page of one build gets its holes refused by another's servers
	 *  (`x-ogygia-deny: foreign-key`, as ogygia's `secret_missing` warns). */
	secret?: string;
	/** Other apps at their own origins (federation's peers): each one build, one instance, behind
	 *  no CDN. The app's servers and the tabs reach them over the network; their content-hashed
	 *  files answer any origin (`access-control-allow-origin: *`), as a peer's CDN does for the
	 *  islands another origin's page imports. */
	peers?: ReadonlyArray<{ readonly origin: string; readonly build: Build }>;
}

/**
 * HOW A DEPLOY GOES OUT, as hosts do it: the new build takes requests, while pages of the old one
 * stay open in tabs.
 */
export interface Rollover {
	/** ms after a deploy during which a request may still reach the old build (a rolling deploy:
	 *  old and new servers side by side), each with even odds. 0: at once. */
	readonly window: number;
	/** The host keeps every release's content-hashed files (`/_app/immutable/`): an old page's
	 *  lazy chunk still downloads. Else they are gone with the old build. */
	readonly old_files: boolean;
	/** The deploy purges the CDN. */
	readonly purge: boolean;
}

/** A deploy that happened. */
export interface Deployed {
	readonly at: number;
	readonly from: string;
	readonly to: string;
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
	/** Each peer app's instance, by origin. */
	readonly peers = new Map<string, ServerInstance>();
	/** Errors no page or server caught, as the host process heard them. */
	readonly uncaught: string[] = [];
	/** The server rules a server said broken (`<instance> <code> <detail>`): ogygia's server rules
	 *  (core server/rules.ts) are said, not thrown, so the host's console is where they surface. */
	readonly server_rules: string[] = [];
	/** Each buggify point asked in this run: whether the swarm turned it on, and how often it fired
	 *  (the coverage a search steers by). */
	readonly buggified = new Map<string, { on: boolean; asked: number; fired: number }>();
	/** The build new requests go to (a deploy moves it). */
	live: string;
	readonly #o: WorldOptions;
	/** Each realm's own stream of buggify draws. */
	readonly #buggify_rng = new Map<string, Rng>();
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
			route: (request, from) => this.#route(request, from),
			origin: ORIGIN,
			buggify: (realm, point) => this.#buggify(realm, point),
			// (the seed's browser engine, as its resource timing reads: most report each status)
			timeline: this.rng.fork('timeline engine').chance(0.7) ? 'status' : 'start'
		});
		this.live = o.builds[0].id;
	}

	/**
	 * Whether `realm` takes the rare branch `point` now. Whether a point is on is the run's (its own
	 * stream, named by the point, so a new point moves no other's choice); whether it fires is the
	 * realm's draw. A firing is written into the log, so a replay that takes another branch shows.
	 */
	#buggify(realm: string, point: string): boolean {
		const o = this.#o.buggify;
		if (o === undefined) return false;
		let seen = this.buggified.get(point);
		if (seen === undefined) {
			seen = { on: this.rng.fork(`buggify swarm ${point}`).chance(o.on), asked: 0, fired: 0 };
			this.buggified.set(point, seen);
		}
		seen.asked++;
		if (!seen.on) return false;
		// (a realm's draws by its name without the document: a reload of a tab is the same stream)
		const key = realm.replace(/#\d+$/, '');
		let r = this.#buggify_rng.get(key);
		if (r === undefined) this.#buggify_rng.set(key, (r = this.rng.fork(`buggify ${key}`)));
		if (!r.chance(o.fires)) return false;
		seen.fired++;
		this.loop.note(`buggify ${realm} ${point}`);
		return true;
	}

	/** Makes a world from `o` and starts its servers. */
	static async make(o: WorldOptions): Promise<World> {
		use_v8_modules();
		modules_in_order();
		inert_parsed_documents();
		inert_custom_elements();
		whole_text_runs();
		documents_by_namespace();
		history_by_document();
		const w = new World(o);
		completion_on_the_loop(w.loop);
		const host = platform({
			name: 'server',
			loop: w.loop,
			rng: w.rng,
			skew: () => current_server.getStore()?.skew ?? 0,
			node: true,
			// (each server instance draws as its own realm)
			buggify: (_, point) => w.#buggify(current_server.getStore()?.name ?? 'server', point)
		});
		const restore_platform = install(globalThis, host);
		const restore_symbols = own_symbols();
		const restore_env = own_env();
		const restore = () => {
			restore_env();
			restore_symbols();
			restore_platform();
		};
		// a server's own `fetch` (Kit reads a prerendered remote answer from its own origin) goes
		// through the world too, like a tab's: never the real network
		const real_fetch = globalThis.fetch;
		globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			const from = current_server.getStore()?.name ?? 'server';
			return w.network.send(from, request, (r) => w.#route(r, from));
		};
		// a page's (or a server's) uncaught error reaches the host process: it is the run's finding,
		// not the simulator's crash
		// (an error from a tab is of the tab's realm: not `instanceof` the host's Error)
		const uncaught = (error: unknown, promise?: unknown) => {
			// (a shown document's rejection is that page's: its window hears it, as in a browser)
			if (
				typeof promise === 'object' &&
				promise !== null &&
				w.browsers.reject_in_page(error, promise as Promise<unknown>)
			)
				return;
			const stack = (error as { stack?: unknown } | null)?.stack;
			w.uncaught.push(
				typeof stack === 'string' ? stack.split('\n').slice(0, 6).join('\n') : String(error)
			);
		};
		process.on('unhandledRejection', uncaught);
		process.on('uncaughtException', uncaught);
		// (a page's console is its window's own: the host's is the servers')
		const host_console = { warn: console.warn, error: console.error };
		const hear = (to: 'warn' | 'error') =>
			function (this: Console, ...args: unknown[]): void {
				const line = args.map(String).join(' ');
				const rule = /ogygiajs\.dev\/e\/(rule_[a-z_]+)(?:\?detail=(\S*))?/.exec(line);
				const server = current_server.getStore();
				if (rule !== null && server !== undefined) {
					// (a query's encoding: `+` is a space)
					const detail =
						rule[2] === undefined ? '' : decodeURIComponent(rule[2].replaceAll('+', ' '));
					w.server_rules.push(`${server.name} ${rule[1]} ${detail}`.trim());
				}
				host_console[to].apply(this, args);
			};
		console.warn = hear('warn');
		console.error = hear('error');
		// a world's servers start from nothing: what they pin on `globalThis` (an app's in-memory
		// store, a counter a command bumps) is taken off when the world ends, so the next world in
		// this process does not start with it (a seed's replay runs after other seeds)
		const globals = new Set(Reflect.ownKeys(globalThis));
		// (the world's servers read it as they sign; the host's own is put back at the end)
		const host_secret = process.env.OGYGIA_SECRET;
		if (o.secret === undefined) delete process.env.OGYGIA_SECRET;
		else process.env.OGYGIA_SECRET = o.secret;
		w.#restore = () => {
			if (host_secret === undefined) delete process.env.OGYGIA_SECRET;
			else process.env.OGYGIA_SECRET = host_secret;
			process.off('unhandledRejection', uncaught);
			process.off('uncaughtException', uncaught);
			console.warn = host_console.warn;
			console.error = host_console.error;
			globalThis.fetch = real_fetch;
			restore();
			for (const key of Reflect.ownKeys(globalThis))
				if (!globals.has(key)) delete (globalThis as Record<PropertyKey, unknown>)[key];
		};
		await w.deploy(o.builds[0]);
		for (const peer of o.peers ?? []) {
			const scratch = o.scratch ?? join(peer.build.output, '..', 'sim');
			w.peers.set(
				peer.origin,
				await start_server(
					`peer-${new URL(peer.origin).hostname}`,
					peer.build,
					peer.origin,
					scratch
				)
			);
		}
		return w;
	}

	/** The deploys so far, in order. */
	readonly deployed: Deployed[] = [];

	/** Deploys the build after the live one (`rollover` says how); false when there is none. */
	async deploy_next(): Promise<boolean> {
		const at = this.#o.builds.findIndex((b) => b.id === this.live);
		const next = this.#o.builds[at + 1];
		if (next === undefined) return false;
		const from = this.live;
		await this.deploy(next);
		this.deployed.push({ at: this.loop.now, from, to: next.id });
		if (this.#o.rollover?.purge) this.cdn.purge();
		this.loop.note(
			`deploy ${from} -> ${next.id} (window ${this.#o.rollover?.window ?? 0} ms, old files ${this.#o.rollover?.old_files ? 'kept' : 'gone'}${this.#o.rollover?.purge ? ', CDN purged' : ''})`
		);
		return true;
	}

	/** Content-hashed files (`/_app/immutable/…`) a request asked a build for that only another
	 *  build has: an old page's file after its build is gone, or, in a rolling deploy's window, a
	 *  file of one build asked of the other's servers. The deploy, not the app, failed them. By who
	 *  asked (a realm: a tab's document, `tab-1#2`). */
	readonly skewed = new Map<string, Set<string>>();

	/** The build every request goes to while it is set (`as_of`). */
	#pinned: string | null = null;

	/** The build that answered each realm's last page request (its document, or the page a client
	 *  navigation brought in). */
	readonly #page_build = new Map<string, string>();

	/** The build the page a document shows came from (the live one if it asked none). */
	build_of(realm: string): string {
		return this.#page_build.get(realm) ?? this.live;
	}

	/** The build that answered each of `realm`'s requests for what is not a file (a page, a hole, an
	 *  endpoint), by {@link answer_key}, its latest answer's: a hole a page asks for after a deploy is
	 *  the new release's. */
	answers_of(realm: string): ReadonlyMap<string, string> {
		const of = new Map<string, string>();
		for (const e of this.network.exchanges) {
			if (e.from !== realm || e.build === undefined) continue;
			const url = new URL(e.url);
			if (!url.pathname.startsWith('/_app/immutable/')) of.set(answer_key(url), e.build);
		}
		return of;
	}

	/** Runs `work` with every request sent to `build` (the MPA check's fresh load of an old page
	 *  asks the build that page is of), or, for a request `answers` names, to the build that answered
	 *  it (the tab's hole asked after a deploy, answered by the new release). */
	async as_of<T>(
		build: string,
		work: () => Promise<T>,
		answers: ReadonlyMap<string, string> = new Map()
	): Promise<T> {
		this.#pinned = build;
		this.#pinned_answers = answers;
		try {
			return await work();
		} finally {
			this.#pinned = null;
			this.#pinned_answers = new Map();
		}
	}
	#pinned_answers: ReadonlyMap<string, string> = new Map();

	/** Whether a deploy failed a download `realm` asked for (`skewed`): a browser names the module
	 *  it imported, not the dependency of it that failed, so any of the document's counts. */
	skewed_for(realm: string): boolean {
		return (this.skewed.get(realm)?.size ?? 0) > 0;
	}

	/** The build a request goes to now: the live one, or during a rolling deploy's window, by even
	 *  odds, the one before it. A content-hashed file only another build has goes to that build
	 *  when the host keeps old files. */
	#build_for(path: string, from: string, key: string): string {
		if (this.#pinned !== null) return this.#pinned_answers.get(key) ?? this.#pinned;
		const last = this.deployed.at(-1);
		let id = this.live;
		if (
			last !== undefined &&
			this.loop.now < last.at + (this.#o.rollover?.window ?? 0) &&
			this.rng.chance(0.5)
		)
			id = last.from;
		if (this.deployed.length > 0 && path.startsWith('/_app/immutable/')) {
			const serves = (b: string) => this.servers.get(b)![0].serves(path);
			const other = serves(id) ? undefined : [...this.servers.keys()].reverse().find(serves);
			if (other !== undefined) {
				if (this.#o.rollover?.old_files) id = other;
				else {
					const list = this.skewed.get(from) ?? new Set<string>();
					this.skewed.set(from, list.add(path));
				}
			}
		}
		if (is_page_path(path)) this.#page_build.set(from, id);
		return id;
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
				list.push(await start_server(`server-${i}`, build, ORIGIN, scratch, skew));
			}
			this.servers.set(build.id, list);
		}
		this.live = build.id;
	}

	/** A request at the front door: the CDN, then the live build's instance the seed picks. */
	#route(request: Request, from = 'server'): Promise<Response> {
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
		// (a peer app: its own server answers; its content-hashed files to any origin)
		const peer = this.peers.get(url.origin);
		if (peer !== undefined)
			return peer.handle(request).then((answer) => {
				if (!url.pathname.startsWith('/_app/immutable/')) return answer;
				const headers = new Headers(answer.headers);
				headers.set('access-control-allow-origin', '*');
				return new Response(answer.body, {
					status: answer.status,
					statusText: answer.statusText,
					headers
				});
			});
		if (url.origin !== ORIGIN || this.#o.supplied?.includes(url.pathname)) {
			const type = url.pathname.endsWith('.css')
				? 'text/css'
				: /\.m?js$/.test(url.pathname)
					? 'text/javascript'
					: 'text/plain';
			return Promise.resolve(new Response('', { headers: { 'content-type': type } }));
		}
		// (a load pinned to a build asks its servers, past the CDN: what is cached may be another's)
		const cdn =
			this.#pinned === null
				? this.cdn
				: { fetch: (r: Request, origin: (r: Request) => Promise<Response>) => origin(r) };
		const key = answer_key(url);
		return cdn.fetch(request, async (r) => {
			const build = this.#build_for(decodeURIComponent(url.pathname), from, key);
			const list = this.servers.get(build)!;
			const answer = await list[this.rng.int(list.length)].handle(r);
			// (a hole one build signed, refused by another's servers for its key: the deploy's doing
			// when the app has no stable secret, as ogygia's `secret_missing` says)
			if (answer.headers.get('x-ogygia-deny') === 'foreign-key' && this.#o.secret === undefined)
				this.skewed.set(from, (this.skewed.get(from) ?? new Set<string>()).add(url.pathname));
			// (which build answered rides with the answer, so a cached copy says it too)
			const headers = new Headers(answer.headers);
			headers.set(ANSWERED_BY, build);
			return new Response(answer.body, {
				status: answer.status,
				statusText: answer.statusText,
				headers
			});
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
			// (nor is a request a server is still working on: its answer is not a task until it
			// comes, and the server's own timer may be due past the gap, a hole that renders in 3 s;
			// seed 46, /ooo)
			const quiet = this.loop.next_of('net') === Infinity && this.network.unanswered() === 0;
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
			for (const s of this.peers.values()) s.stop();
		}
	}
}
