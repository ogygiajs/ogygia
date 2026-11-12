/**
 * The browsers of the world: happy-dom, one `Browser` per visitor (its own cookies), any number of
 * tabs each. happy-dom is the DOM chosen (internal/notes/dst.md says why): it runs a page's module
 * scripts and their dynamic `import()`s itself, through its own fetch, which this file routes into
 * the simulated network; it has tabs, history (back, forward, reload) and a cookie jar; and it calls
 * us before a document's first script (`beforeContentCallback`), which is where each document gets
 * its simulated platform.
 *
 * Each document is its own realm in the loop (`tab-2#3`: tab 2's third document), so a document's
 * timers die with it when the tab navigates away, as in a browser.
 */
import { Browser, type BrowserPage, type BrowserWindow } from 'happy-dom';
import CookieStringUtility from 'happy-dom/lib/cookie/urilities/CookieStringUtility.js';
import * as PropertySymbol from 'happy-dom/lib/PropertySymbol.js';
import WindowBrowserContext from 'happy-dom/lib/window/WindowBrowserContext.js';
import type { Loop } from './loop.ts';
import type { Network } from './network.ts';
import { install, message_channel, platform, site, SITES, type RealmOptions } from './platform.ts';
import { hash, type Rng } from './rng.ts';
import { install_timeline, record_download, type Engine } from './timeline.ts';

/** `SIM_STACKS=1`: a page's uncaught error carries its stack (to triage a seed). */
const STACKS = process.env.SIM_STACKS === '1';

/** Where a tab's requests go: the world's front door (the CDN, then the servers). */
export type Route = (request: Request, from: string) => Promise<Response>;

export interface Tab {
	readonly name: string;
	readonly page: BrowserPage;
	/** The realm of the document it shows now. */
	realm: string;
	/** Documents it has shown. */
	documents: number;
	/** What the page reported: uncaught errors, failed scripts, console errors. */
	readonly errors: string[];
	readonly console: string[];
	/** The realm of the document that said each line of `errors` and `console`. */
	readonly said_by: Map<string, string>;
	/** The document's simulated platform (its outstanding timers, for the leak oracle). */
	platform: ReturnType<typeof platform> | null;
	/** What the shown document holds now (the leak oracle's sample). */
	held(): Held;
	/** The listeners it holds, each as `window|document <type> <its code's hash>` (with
	 *  `SIM_SITES=1`, and the line that added it): the leak oracle's per-listener counts. */
	listening(): string[];
	/** The observers observing, each as `<Name> <its callback's code hash>`: the leak oracle's
	 *  per-observer counts. */
	watching(): string[];
	/** Observers still observing whose every watched element has left the document (their owner
	 *  ended and nothing disconnected them), each as `<Name> watching <the first one's tag>`. */
	orphans(): string[];
	/** When the router swapped the shown document's page (`og:before-swap`, virtual ms): where one
	 *  visit of the document ends and the next begins. */
	swaps: number[];
	/** Each document's {@link swaps}, by realm, a left one's too. */
	readonly swaps_by: Map<string, number[]>;
}

/** What a document holds that outlives a page visit if nobody lets it go. */
export interface Held {
	/** Listeners on its window and document. */
	readonly listeners: number;
	/** Intervals running (a timeout ends on its own; an interval a closed visit forgot runs forever). */
	readonly intervals: number;
	/** Observers observing (Intersection, Mutation, Resize, Performance). */
	readonly observers: number;
	/** `<head>`'s children (each client navigation merges a head in: one that only grows leaks). */
	readonly head: number;
	/** Elements in the document, less what its regions show (the same page, visited again, shows
	 *  the same page). */
	readonly elements: number;
}

export interface Visitor {
	readonly name: string;
	readonly browser: Browser;
	readonly tabs: Tab[];
}

export interface BrowsersOptions {
	loop: Loop;
	rng: Rng;
	network: Network;
	route: Route;
	/** The app's origin (`https://app.test`). */
	origin: string;
	/** The world's buggify swarm, for each tab's platform. */
	buggify?: (realm: string, point: string) => boolean;
	/** How each document's resource timing reads (./timeline.ts). Default `status`. */
	timeline?: Engine;
}

export class Browsers {
	readonly #o: BrowsersOptions;
	readonly visitors: Visitor[] = [];
	#tabs = 0;

	constructor(options: BrowsersOptions) {
		this.#o = options;
		options.network.tell((name, online) => this.#line(name, online));
	}

	/** A tab lost the network or got it back: its document hears it, as a task of its own
	 *  (`offline` or `online` on its window; `navigator.onLine` reads the network: `#arrive`). */
	#line(name: string, online: boolean): void {
		const tab = this.visitors.flatMap((v) => v.tabs).find((t) => t.name === name);
		if (tab === undefined) return;
		const window = tab.page.mainFrame.window as unknown as Window & { Event: typeof Event };
		const type = online ? 'online' : 'offline';
		this.#o.loop.add(tab.realm, type, 0, () => window.dispatchEvent(new window.Event(type)));
	}

	/** A new visitor: their own browser, cookies and storage. */
	visitor(name: string): Visitor {
		const o = this.#o;
		const browser = new Browser({
			settings: {
				disableErrorCapturing: false,
				// (a simulated page runs the app's own scripts: the trusted code under test)
				enableJavaScriptEvaluation: true,
				suppressInsecureJavaScriptEnvironmentWarning: true,
				disableJavaScriptFileLoading: false,
				// (stylesheets load over the simulated network: the router moves them between pages)
				enableCSSFileLoading: true,
				navigator: {
					userAgent: 'Mozilla/5.0 (ogygia-sim) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'
				},
				fetch: {
					interceptor: {
						beforeAsyncRequest: async ({ request, window }) => {
							// (a document's own request comes from its new window, before it arrives: it is
							// the request of the realm the tab is about to get)
							const known = this.#windows.get(window);
							const tab = known ?? this.#find(window);
							const from =
								known !== undefined
									? known.realm
									: tab !== undefined
										? `${tab.name}#${tab.documents + 1}`
										: 'browser';
							const W = window as unknown as {
								Response: typeof Response;
								Headers: typeof Headers;
								TypeError: typeof TypeError;
							};
							let url = new URL(request.url);
							let method = request.method;
							let body =
								method === 'GET' || method === 'HEAD'
									? undefined
									: new Uint8Array(await request.arrayBuffer());
							const jar = this.#context_of(browser);
							// (a shown document's download is in its resource timing, with what it got)
							const timed = known !== undefined ? window : null;
							const started = timed
								? (window as unknown as { performance: { now(): number } }).performance.now()
								: 0;
							const timing = (status: number | null) => {
								if (timed)
									record_download(timed, o.timeline ?? 'status', request.url, status, started);
							};
							// a browser follows a redirect itself (happy-dom hands an intercepted answer back as
							// it is): each leg is a request on the network, with its cookies, and the answer
							// carries the URL it came from (a document's address is that URL)
							for (let hops = 0; ; hops++) {
								const headers = new Headers();
								request.headers.forEach((v: string, k: string) => headers.set(k, v));
								if (body === undefined) headers.delete('content-type');
								const cookies = jar.cookieContainer.getCookies(url, false);
								if (cookies.length > 0)
									headers.set('cookie', CookieStringUtility.cookiesToString(cookies));
								// the page it came from, by the request's policy (happy-dom works it out before
								// the interceptor and adds the header after it: test/referer.test.ts)
								const referrer = (request as unknown as Record<symbol, unknown>)[
									PropertySymbol.referrer
								];
								if (referrer instanceof URL) headers.set('referer', referrer.href);
								// a browser sends its document's origin with every request that is not a GET
								// or HEAD (happy-dom does not; Kit refuses a remote call without it: 403)
								if (method !== 'GET' && method !== 'HEAD' && !headers.has('origin'))
									headers.set(
										'origin',
										new URL((window as unknown as { location: { href: string } }).location.href)
											.origin
									);
								const sent = new Request(url, { method, headers, body });
								let answer: Response;
								try {
									answer = await o.network.send(from, sent, (r) => o.route(r, from));
								} catch (error) {
									timing(null);
									throw new W.TypeError(error instanceof Error ? error.message : String(error));
								}
								for (const c of answer.headers.getSetCookie()) {
									const cookie = CookieStringUtility.stringToCookie(url, c);
									if (cookie) jar.cookieContainer.addCookies([cookie]);
								}
								const location = answer.headers.get('location');
								const redirect = [301, 302, 303, 307, 308].includes(answer.status);
								if (redirect && location !== null && request.redirect !== 'manual') {
									void answer.body?.cancel();
									if (request.redirect === 'error' || hops === 20) {
										timing(null);
										throw new W.TypeError('Failed to fetch (redirect)');
									}
									url = new URL(location, url);
									// (303, and 301/302 after a POST, go on as a GET without the body)
									if (answer.status === 303 || (answer.status < 303 && method === 'POST')) {
										method = method === 'HEAD' ? 'HEAD' : 'GET';
										body = undefined;
									}
									continue;
								}
								const out = new W.Headers();
								answer.headers.forEach((v, k) => {
									if (k === 'set-cookie') return;
									out.append(k, v);
								});
								const response = new W.Response(answer.body, {
									status: answer.status,
									statusText: answer.statusText,
									headers: out
								}) as Response & { url: string; redirected: boolean };
								Object.assign(response, { url: url.href, redirected: hops > 0 });
								timing(answer.status);
								return response as never;
							}
						}
					}
				},
				navigation: {
					beforeContentCallback: (window: BrowserWindow) => this.#arrive(window)
				}
			}
		});
		const v: Visitor = { name, browser, tabs: [] };
		this.visitors.push(v);
		return v;
	}

	readonly #windows = new WeakMap<object, Tab>();
	/** The last error happy-dom wrote to a tab's page console (why an element's load failed). */
	readonly #said = new WeakMap<Tab, string>();
	/** Documents (realms) a script or stylesheet of which failed to load, or a module ogygia says
	 *  needs a reload (`chunk_reload_needed`): a browser never loads it again, so the page stays
	 *  without it whatever the network does next. */
	readonly #unloaded = new Set<string>();

	/** Whether a script or stylesheet of document `realm` failed to load. */
	lacks_a_file(realm: string): boolean {
		return this.#unloaded.has(realm);
	}

	#context_of(browser: Browser) {
		return browser.defaultContext as unknown as {
			cookieContainer: {
				getCookies(url: URL, http: boolean): never[];
				addCookies(c: unknown[]): void;
			};
		};
	}

	/** A document is about to run its first script: it gets its realm and simulated platform. */
	#arrive(window: BrowserWindow): void {
		const tab = this.#find(window);
		// (a frame inside the page is not the tab's document)
		if (tab === undefined || (tab.page.mainFrame.window as unknown) !== window) return;
		this.#o.loop.drop(tab.realm);
		tab.documents++;
		tab.realm = `${tab.name}#${tab.documents}`;
		const options: RealmOptions = {
			name: tab.realm,
			loop: this.#o.loop,
			rng: this.#o.rng,
			buggify: this.#o.buggify
		};
		const p = platform(options);
		install(window, p);
		if ((window as unknown as { MessageChannel?: unknown }).MessageChannel === undefined)
			Object.defineProperty(window, 'MessageChannel', {
				value: message_channel(this.#o.loop, tab.realm),
				writable: true,
				configurable: true
			});
		// happy-dom has no SVGAElement (an `<a>` inside `<svg>`, a link a router must handle):
		// what `instanceof SVGAElement` would answer in a browser
		const w_svg = window as unknown as { SVGAElement?: unknown; SVGElement: new () => object };
		if (w_svg.SVGAElement === undefined) {
			const SVGElement = w_svg.SVGElement;
			Object.defineProperty(window, 'SVGAElement', {
				value: class SVGAElement extends SVGElement {
					static [Symbol.hasInstance](el: unknown): boolean {
						return el instanceof SVGElement && (el as Element).localName === 'a';
					}
				},
				writable: true,
				configurable: true
			});
		}
		install_timeline(window);
		// (the tab's network, as a browser's `navigator.onLine` reads its own: test/online.node.test.ts)
		const network = this.#o.network;
		Object.defineProperty(window.navigator, 'onLine', {
			get: () => network.online(tab.name),
			configurable: true
		});
		tab.platform = p;
		this.#windows.set(window, tab);
		// (heard before the listener count starts: the simulator's own ear, not the page's; on the
		// window while capturing, as writing the document's content drops the document's listeners)
		const swaps: number[] = (tab.swaps = []);
		tab.swaps_by.set(tab.realm, swaps);
		const loop = this.#o.loop;
		window.addEventListener('og:before-swap', () => swaps.push(loop.now), { capture: true });
		this.#count_held(window, tab);
		const w = window as unknown as {
			addEventListener(
				type: string,
				fn: (e: { message?: string; reason?: unknown; error?: unknown }) => void
			): void;
			console: Record<string, (...a: unknown[]) => void>;
		};
		// (a document the tab has left says nothing: its scripts stop in a browser, and what still
		// settles here, a module linking over a closed window, is the DOM library's, not the app's)
		const shown = (): boolean => (tab.page.mainFrame.window as unknown) === window;
		w.addEventListener('error', (e) => {
			// (SIM_STACKS=1 says where it was thrown, to triage a seed; off, the trace is unchanged)
			const stack = STACKS ? `\n${String((e.error as Error | undefined)?.stack)}` : '';
			// (a thrown value with no `message`, as Kit's HttpError, gives an empty one: say the value)
			if (shown()) tab.errors.push(`error: ${e.message || String(e.error)}${stack}`);
		});
		// a script or stylesheet of this document that failed: happy-dom writes why to the page's
		// console and fires `error` on the element (which does not bubble: heard while capturing)
		(w as unknown as EventTarget).addEventListener(
			'error',
			(e) => {
				const el = e.target as Element | null;
				if (el === null || (el as unknown) === window || typeof el.getAttribute !== 'function')
					return;
				const why = this.#said.get(tab) ?? '';
				this.#said.delete(tab);
				if (shown()) this.#unloaded.add(tab.realm);
				if (shown())
					tab.errors.push(
						`error: <${el.localName}> ${el.getAttribute('src') ?? el.getAttribute('href') ?? ''} failed${why ? `: ${why}` : ''}`
					);
			},
			true
		);
		w.addEventListener('unhandledrejection', (e) => {
			const stack = STACKS ? `\n${String((e.reason as Error | undefined)?.stack)}` : '';
			if (shown()) tab.errors.push(`unhandled: ${String(e.reason)}${stack}`);
		});
		// (happy-dom gives every document of a page the page's one console: each gets its own here,
		// so what a left document's code still says is told apart from the shown one's)
		const page_console = w.console;
		const own = Object.create(page_console) as Record<string, (...a: unknown[]) => void>;
		// (every other method runs on the page's console itself: happy-dom's reads its own private
		// fields, and called on this one it threw, `Cannot read private member #printer`, the first
		// time an island logged on a press)
		for (
			let p: object | null = page_console;
			p !== null && p !== Object.prototype;
			p = Object.getPrototypeOf(p)
		)
			for (const key of Object.getOwnPropertyNames(p)) {
				const f = (page_console as Record<string, unknown>)[key];
				if (key !== 'constructor' && typeof f === 'function' && !Object.hasOwn(own, key))
					own[key] = (...args: unknown[]) => f.apply(page_console, args);
			}
		for (const level of ['error', 'warn'] as const) {
			own[level] = (...args: unknown[]) => {
				if (!shown()) return;
				const line = `${level}: ${args.map((a) => (a instanceof Error || (a as { stack?: string })?.stack ? `${String(a)}\n${(a as Error).stack}` : String(a))).join(' ')}`;
				// (ogygia's own word that a chunk's dependency failed: the browser keeps it failed, and
				// no retry loads it until the page reloads, as a script that failed to load: #262)
				if (line.includes('/e/chunk_reload_needed')) this.#unloaded.add(tab.realm);
				tab.console.push(`${line}${STACKS ? `\n${new Error('said at').stack}` : ''}`);
				page_console[level]?.call(page_console, ...args);
			};
		}
		Object.defineProperty(window, 'console', { value: own, writable: true, configurable: true });
	}

	/**
	 * Counts what the document holds (`tab.held()`): listeners on its window and document (each
	 * type, listener and capture flag once, as the DOM keeps them), its platform's intervals, and its
	 * observers between `observe()` and `disconnect()`.
	 */
	#count_held(window: BrowserWindow, tab: Tab): void {
		/** Each listener's key, to its label. */
		const listeners = new Map<string, string>();
		const ids = new WeakMap<object, number>();
		let next = 0;
		const key = (type: string, fn: unknown, options: unknown): string => {
			const capture =
				typeof options === 'boolean' ? options : !!(options as { capture?: boolean })?.capture;
			if (typeof fn !== 'object' && typeof fn !== 'function') return '';
			let id = ids.get(fn as object);
			if (id === undefined) ids.set(fn as object, (id = ++next));
			return `${type} ${id} ${capture}`;
		};
		// (a listener's code, as a hash of its source: a closure made again each visit is the same
		// code each time, where a listener installed once for the document is code met once)
		const codes = new WeakMap<object, string>();
		const code_of = (fn: unknown): string => {
			if (typeof fn !== 'function') return 'object';
			let c = codes.get(fn);
			if (c === undefined)
				codes.set(fn, (c = hash(Function.prototype.toString.call(fn)).toString(36)));
			return c;
		};
		const doc = (window as unknown as { document: object }).document;
		for (const [name, target] of [
			['window', window],
			['document', doc]
		] as const) {
			const t = target as unknown as {
				addEventListener(type: string, fn: unknown, options?: unknown): void;
				removeEventListener(type: string, fn: unknown, options?: unknown): void;
			};
			const add = t.addEventListener;
			const remove = t.removeEventListener;
			t.addEventListener = function (type, fn, options) {
				// (a `once` listener or one with a signal lets itself go: counted while it may still fire)
				const k = key(type, fn, options);
				if (k)
					listeners.set(
						`${name} ${k}`,
						`${name} ${type} ${code_of(fn)}${SITES ? ` @ ${site()}` : ''}`
					);
				const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
				signal?.addEventListener('abort', () => listeners.delete(`${name} ${k}`), { once: true });
				return add.call(this, type, fn, options);
			};
			t.removeEventListener = function (type, fn, options) {
				listeners.delete(`${name} ${key(type, fn, options)}`);
				return remove.call(this, type, fn, options);
			};
		}
		const observing = new Set<object>();
		/** What each observer watches (an element; a PerformanceObserver watches none). */
		const watched = new WeakMap<object, { name: string; targets: Set<Element> }>();
		/** Each observer as its kind and its callback's code (the leak check's per-observer counts). */
		const made_by = new WeakMap<object, string>();
		const w = window as unknown as Record<string, unknown>;
		for (const name of [
			'IntersectionObserver',
			'MutationObserver',
			'ResizeObserver',
			'PerformanceObserver'
		]) {
			const Real = w[name] as (new (...a: unknown[]) => object) | undefined;
			if (typeof Real !== 'function') continue;
			const Counted = class extends Real {
				constructor(...a: unknown[]) {
					super(...a);
					made_by.set(this, `${name} ${code_of(a[0])}`);
				}
				observe(...a: unknown[]): unknown {
					observing.add(this);
					if (a[0] !== null && typeof a[0] === 'object' && 'isConnected' in a[0]) {
						let mine = watched.get(this);
						if (mine === undefined) watched.set(this, (mine = { name, targets: new Set() }));
						mine.targets.add(a[0] as Element);
					}
					return (Real.prototype as { observe(...a: unknown[]): unknown }).observe.apply(this, a);
				}
				unobserve(...a: unknown[]): unknown {
					watched.get(this)?.targets.delete(a[0] as Element);
					return (Real.prototype as { unobserve(...a: unknown[]): unknown }).unobserve.apply(
						this,
						a
					);
				}
				disconnect(): unknown {
					observing.delete(this);
					watched.delete(this);
					return (Real.prototype as { disconnect(): unknown }).disconnect.call(this);
				}
			};
			Object.defineProperty(Counted, 'name', { value: name });
			Object.defineProperty(window, name, { value: Counted, writable: true, configurable: true });
		}
		const p = tab.platform;
		const d = doc as unknown as {
			head: Element | null;
			getElementsByTagName(t: string): unknown[];
		};
		tab.held = () => ({
			listeners: listeners.size,
			intervals: p?.pending().filter((l) => l.startsWith('interval')).length ?? 0,
			observers: observing.size,
			head: d.head?.children.length ?? 0,
			// (a region counts, what it shows does not: a live query that failed on one visit and
			// shows its region on the next is not a leak, gen 25 seed 10; what a region shows is
			// judged against a fresh load by the MPA check)
			elements:
				d.getElementsByTagName('*').length -
				(d as unknown as Document).querySelectorAll('ogygia-region *').length
		});
		tab.listening = () => [...listeners.values()].sort();
		tab.watching = () => [...observing].map((o) => made_by.get(o) ?? 'observer').sort();
		tab.orphans = () => {
			const out: string[] = [];
			for (const o of observing) {
				const mine = watched.get(o);
				if (mine === undefined || mine.targets.size === 0) continue;
				const targets = [...mine.targets];
				if (targets.some((t) => t.isConnected)) continue;
				const t = targets[0];
				const id = t.getAttribute?.('id');
				out.push(
					`${mine.name} watching <${t.tagName?.toLowerCase() ?? t.nodeName}${id ? ` id="${id}"` : ''}>`
				);
			}
			return out.sort();
		};
	}

	/**
	 * A rejection nobody handled, from a promise of a shown document's realm: the page's, as in a
	 * browser, which fires `unhandledrejection` on that window (the tab's listener records it, and
	 * ogygia's rules hear it). A vm context's promise reaches the host's process otherwise. False
	 * when no shown document made it (the host's, or a document already left).
	 */
	reject_in_page(reason: unknown, promise: Promise<unknown>): boolean {
		for (const v of this.visitors)
			for (const t of v.tabs) {
				const w = t.page.mainFrame.window as unknown as {
					Promise: PromiseConstructor;
					Event: typeof Event;
					dispatchEvent(e: Event): boolean;
				};
				if (!(promise instanceof w.Promise)) continue;
				const e = new w.Event('unhandledrejection', { cancelable: true });
				Object.assign(e, { reason, promise });
				w.dispatchEvent(e);
				return true;
			}
		return false;
	}

	#find(window: BrowserWindow): Tab | undefined {
		// (by page: a window being replaced by a navigation is no longer, or not yet, the main frame's)
		const page = new WindowBrowserContext(window).getBrowserPage();
		for (const v of this.visitors)
			for (const t of v.tabs)
				if ((t.page.mainFrame.window as unknown) === window || t.page === page) return t;
		return undefined;
	}

	/** Opens a tab for `v` (blank until it goes somewhere). */
	open(v: Visitor): Tab {
		const name = `tab-${++this.#tabs}`;
		const page = v.browser.newPage();
		const tab: Tab = {
			name,
			page,
			realm: `${name}#0`,
			documents: 0,
			errors: [],
			console: [],
			platform: null,
			held: () => ({ listeners: 0, intervals: 0, observers: 0, head: 0, elements: 0 }),
			listening: () => [],
			watching: () => [],
			orphans: () => [],
			swaps: [],
			swaps_by: new Map(),
			said_by: new Map()
		};
		// (each line said is the document's that said it: one action can show several documents,
		// and a line is judged by its own document's faults; generated app 10, seed 78)
		for (const list of [tab.errors, tab.console]) {
			const push = list.push.bind(list);
			list.push = (...lines: string[]) => {
				for (const l of lines) tab.said_by.set(l, tab.realm);
				return push(...lines);
			};
		}
		v.tabs.push(tab);
		this.#windows.set(page.mainFrame.window, tab);
		// (happy-dom reports a failed script or stylesheet here, then fires `error` on its element:
		// the element's listener, in #arrive, says it with this text)
		const pc = page.console as unknown as Record<string, (...a: unknown[]) => void>;
		const error = pc.error;
		pc.error = (...args: unknown[]) => {
			this.#said.set(tab, args.map((a) => String(a)).join(' '));
			error.call(pc, ...args);
		};
		return tab;
	}

	/**
	 * Starts a hard navigation of `tab` (a typed URL, back, forward, reload). It needs the loop to run
	 * (its document and scripts come over the simulated network), so it is not awaited here: the
	 * world runs the loop, and the returned promise settles when the document has loaded.
	 */
	navigate(tab: Tab, how: 'goto' | 'back' | 'forward' | 'reload', path = '/'): Promise<void> {
		const page = tab.page;
		const go =
			how === 'goto'
				? page.goto(new URL(path, this.#o.origin).href)
				: how === 'back'
					? page.goBack()
					: how === 'forward'
						? page.goForward()
						: page.reload();
		return go.then(
			() => {},
			(error: unknown) => {
				tab.errors.push(`navigation: ${error instanceof Error ? error.message : String(error)}`);
			}
		);
	}

	/** Closes `tab`: its document's tasks go with it. */
	async close(v: Visitor, tab: Tab): Promise<void> {
		this.#o.loop.drop(tab.realm);
		v.tabs.splice(v.tabs.indexOf(tab), 1);
		// (a page closes once its documents finish, which happy-dom judges on the loop: run it)
		let closed = false;
		const closing = tab.page.close().then(() => {
			closed = true;
		});
		while (!closed && (await this.#o.loop.step()));
		// (a loop with nothing left before its horizon cannot finish the close: the world's end
		// closes the page on real time, with every browser; waiting here would wait forever)
		if (closed) await closing;
	}

	/** Closes every browser. */
	async end(): Promise<void> {
		for (const v of this.visitors) await v.browser.close();
	}
}
