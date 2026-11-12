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
import WindowBrowserContext from 'happy-dom/lib/window/WindowBrowserContext.js';
import type { Loop } from './loop.ts';
import type { Network } from './network.ts';
import { install, message_channel, platform, type RealmOptions } from './platform.ts';
import type { Rng } from './rng.ts';

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
	/** The document's simulated platform (its outstanding timers, for the leak oracle). */
	platform: ReturnType<typeof platform> | null;
	/** What the shown document holds now (the leak oracle's sample). */
	held(): Held;
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
	/** Elements in the document (the same page, visited again, shows the same page). */
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
}

export class Browsers {
	readonly #o: BrowsersOptions;
	readonly visitors: Visitor[] = [];
	#tabs = 0;

	constructor(options: BrowsersOptions) {
		this.#o = options;
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
							const url = new URL(request.url);
							const headers = new Headers();
							request.headers.forEach((v: string, k: string) => headers.set(k, v));
							const jar = this.#context_of(browser);
							const cookies = jar.cookieContainer.getCookies(url, false);
							if (cookies.length > 0)
								headers.set('cookie', CookieStringUtility.cookiesToString(cookies));
							// a browser sends its document's origin with every request that is not a GET
							// or HEAD (happy-dom does not; Kit refuses a remote call without it: 403)
							if (request.method !== 'GET' && request.method !== 'HEAD' && !headers.has('origin'))
								headers.set(
									'origin',
									new URL((window as unknown as { location: { href: string } }).location.href)
										.origin
								);
							const body =
								request.method === 'GET' || request.method === 'HEAD'
									? undefined
									: new Uint8Array(await request.arrayBuffer());
							const sent = new Request(url, { method: request.method, headers, body });
							let answer: Response;
							try {
								answer = await o.network.send(from, sent, (r) => o.route(r, from));
							} catch (error) {
								throw new (window as unknown as { TypeError: typeof TypeError }).TypeError(
									error instanceof Error ? error.message : String(error)
								);
							}
							const out = new (window as unknown as { Headers: typeof Headers }).Headers();
							answer.headers.forEach((v, k) => {
								if (k === 'set-cookie') return;
								out.append(k, v);
							});
							for (const c of answer.headers.getSetCookie()) {
								const cookie = CookieStringUtility.stringToCookie(url, c);
								if (cookie) jar.cookieContainer.addCookies([cookie]);
							}
							const W = window as unknown as { Response: typeof Response };
							return new W.Response(answer.body, {
								status: answer.status,
								statusText: answer.statusText,
								headers: out
							}) as never;
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
		const options: RealmOptions = { name: tab.realm, loop: this.#o.loop, rng: this.#o.rng };
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
		tab.platform = p;
		this.#windows.set(window, tab);
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
				if (shown())
					tab.errors.push(
						`error: <${el.localName}> ${el.getAttribute('src') ?? el.getAttribute('href') ?? ''} failed${why ? `: ${why}` : ''}`
					);
			},
			true
		);
		w.addEventListener('unhandledrejection', (e) => {
			if (shown()) tab.errors.push(`unhandled: ${String(e.reason)}`);
		});
		// (happy-dom gives every document of a page the page's one console: each gets its own here,
		// so what a left document's code still says is told apart from the shown one's)
		const page_console = w.console;
		const own = Object.create(page_console) as Record<string, (...a: unknown[]) => void>;
		for (const level of ['error', 'warn'] as const) {
			own[level] = (...args: unknown[]) => {
				if (!shown()) return;
				tab.console.push(
					`${level}: ${args.map((a) => (a instanceof Error || (a as { stack?: string })?.stack ? `${String(a)}\n${(a as Error).stack}` : String(a))).join(' ')}${STACKS ? `\n${new Error('said at').stack}` : ''}`
				);
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
		const listeners = new Set<string>();
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
				if (k) listeners.add(`${name} ${k}`);
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
				observe(...a: unknown[]): unknown {
					observing.add(this);
					return (Real.prototype as { observe(...a: unknown[]): unknown }).observe.apply(this, a);
				}
				disconnect(): unknown {
					observing.delete(this);
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
			elements: d.getElementsByTagName('*').length
		});
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
			held: () => ({ listeners: 0, intervals: 0, observers: 0, head: 0, elements: 0 })
		};
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
