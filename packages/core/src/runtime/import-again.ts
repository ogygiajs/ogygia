/**
 * A LAZY CHUNK THAT FAILED TO DOWNLOAD, ASKED FOR AGAIN. A browser keeps a module whose download
 * failed in its module map for the life of the page: a second `import()` of the same URL fails at
 * once, without a request (Chromium and Firefox both do; the e2e lazy-chunk-retry spec proves it).
 * Retrying the same `import()` therefore does nothing. What works is the same file under a new URL:
 * the next attempt imports the loader's own file with an `og-retry` query (a static server ignores
 * it; a module never evaluated, so no second copy of its state exists).
 *
 * The loader knows its own file: the build hands each one it (@ogygia/compiler vite/lazy-files.ts), and an island's
 * caller knows its file. Never the URL a failure names: WebKit's error names none (#385), and
 * Firefox's names the file that failed, which can be a dependency of the one imported: asked for as
 * if it were the loader's own, it ran a second copy of a shared module and stood in for the chunk
 * (#392). A loader that knows no file (a module that shares its chunk with others) tries the plain
 * import again, which fails the same way: a dropped chunk stays dropped until the page reloads.
 *
 * One failure no URL fixes: a static dependency of the chunk that failed. The chunk under a fresh
 * URL imports the dependency's own URL, which the browser keeps failed: every retry fails the same
 * way (#262). Told apart by the retry itself — it failed, yet its own file came (the browser's
 * resource timing holds its response): asking again cannot help, so the loader stops asking, and
 * the page says once that it needs a reload.
 *
 * A leaf: the boot and island-side code (devalue's lane, the entry locations) import it, so it
 * imports nothing of the boot (only `@ogygia/machine`, which the boot runs on); the boot hands it
 * its message (`on_reload_needed`).
 */
import { cache, flights, machine, registry, say, scope, STALE, type Scope } from '@ogygia/machine';

/** How long a failed import waits for its file's timing entry before it reads as "no response". */
const ENTRY_WAIT_MS = 1000;

// ── THE PAGE'S DOWNLOADS, AS THE BROWSER REPORTS THEM (#450) ──────────────────────────────────
// Whether a failed import's own file came is read from the browser's resource timing. The page's
// shared timeline (`performance.getEntriesByName`) holds 250 entries by default, and a large page
// fills it by the end of its load: nothing later is recorded there, and every retry read as "no
// response". An observer hears every entry whether the timeline is full or not, so the loader keeps
// its own record, from the first loader made (the boot's) on: what each download got.

/** Downloads recorded, at most (the oldest go first): enough for every file a page loads. */
const RESPONSES_MAX = 2000;
/** Each download heard: its status (`null`: no response came, a dropped download). */
const responses = cache<string, number | null>({ name: 'heard downloads', max: RESPONSES_MAX });
/** Callers waiting for a download's entry, each held by its wait's scope: called with its status
 *  when it lands. */
const landing = registry<{ url: string; done: (status: number | null) => void }>();
/** The observer's owner, once it is up (the document's: a file's load outlives any page visit). */
let timeline: Scope | null = null;

function hear_responses(): void {
	if (timeline !== null || typeof PerformanceObserver === 'undefined') return;
	timeline = scope();
	try {
		// (buffered: what the timeline already holds is heard at once, then every entry after it)
		timeline
			.watch(
				new PerformanceObserver((list) => {
					for (const e of list.getEntries()) heard(e.name, status_of([e]));
				})
			)
			.observe({ type: 'resource', buffered: true });
	} catch {
		// ok: an engine with no resource entries to observe: nothing is heard, every read is the timeline's
	}
}

function heard(url: string, status: number | null): void {
	// (a response heard for a URL is kept over a later entry with none)
	const now = status ?? responses.peek(url) ?? null;
	responses.set(url, now);
	// (each wait that is done leaves the registry: a walk does not reach one removed)
	for (const w of landing) if (w.url === url) w.done(now);
}

/**
 * The status the download of `url` got, once the browser reports it, or `null` after
 * {@link ENTRY_WAIT_MS}. An engine can reject a failed import before its entry lands, and later
 * than one task: Firefox on a loaded machine. Chromium and Firefox give every download an entry (a
 * dropped one too, with a status of 0); WebKit gives a dropped one none, so only there the wait
 * runs out. Its own scope: it ends itself, and no page's visit owns a file's load.
 */
function response_landed(url: string): Promise<number | null> {
	const now = response_of(url);
	if (now !== null || responses.has(url) || timeline === null) return Promise.resolve(now);
	const wait = scope();
	return new Promise<number | null>((resolve) => {
		const done = (status: number | null) => {
			wait.close();
			resolve(status);
		};
		landing.add({ url, done }, wait);
		wait.timeout(() => done(null), ENTRY_WAIT_MS);
	});
}

/** A failed dynamic import's message: Chromium "Failed to fetch dynamically imported module: <url>",
 *  Firefox "error loading dynamically imported module: <url>". */
const FAILED_IMPORT_RE = /dynamically imported module:?\s+\S/i;
/** WebKit's (Safari's) failed import, which names no URL: "Importing a module script failed." */
const WEBKIT_IMPORT_FAILED_RE = /^importing a module script failed\.?$/i;

/** Whether `error` is a dynamic import that failed to load (any engine's wording), not an error the
 *  module threw as it ran. */
export function is_failed_import(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	return FAILED_IMPORT_RE.test(message) || WEBKIT_IMPORT_FAILED_RE.test(message);
}

/** A loader's file as a URL: against `base` (the loader's module), else the page (an island's entry
 *  is named as the page names it, root-relative); null when it names no http(s) URL. The retry is
 *  always this file, the one the first load asked for, so it goes only where a first load went: a
 *  peer's island to the peer's origin (#956), never an origin only an error's text names. Never
 *  throws: it runs inside a failed import's handler, whose own error is what the caller hears. */
function file_url(file: string, base: string | undefined): string | null {
	try {
		const url = new URL(
			file,
			base ?? (typeof location !== 'undefined' ? location.href : undefined)
		);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
	} catch {
		return null; // ok: no URL to ask again under; the loader loads the plain way next time
	}
}

/** `url` with its retry mark: a URL the module map has not seen. */
export function retry_url(url: string, attempt: number): string {
	const u = new URL(url);
	u.searchParams.set('og-retry', String(attempt));
	return u.href;
}

/** The status of the response the browser reported for `url` (0 where the browser does not say), or
 *  `null` when none came: a download that failed (or no entry for it yet). The loader's own record
 *  first (it hears a full timeline too), then the page's timeline. */
export function response_of(url: string): number | null {
	const heard_status = responses.get(url);
	if (heard_status != null) return heard_status;
	if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function')
		return null;
	return status_of(performance.getEntriesByName(url, 'resource'));
}

/** {@link response_of}, read from `entries` (one file's resource-timing entries). */
function status_of(entries: readonly PerformanceEntry[]): number | null {
	let status: number | null = null;
	for (const e of entries) {
		const t = e as PerformanceResourceTiming & { responseStatus?: number };
		// An engine that reports the status says 0 for a download that got no response (Firefox
		// gives a dropped one a response start too); one that does not (WebKit) is read by its
		// response start alone.
		if (typeof t.responseStatus === 'number') {
			if (t.responseStatus > 0) status = t.responseStatus;
		} else if (t.responseStart > 0) status = 0;
	}
	return status;
}

/** What the page says when a chunk cannot load until it reloads: the boot's message (./core.ts). */
let say_reload_needed: (url: string, error: unknown) => void = () => {};
/** Said once per page (for the first such chunk: one reload loads them all). */
const reload = say({ max: 1 });
/** The boot hands over its message for a chunk no retry can load. */
export function on_reload_needed(say: (url: string, error: unknown) => void): void {
	say_reload_needed = say;
}

/** What the page notes of an island file's load (the boot's: region-sheets.ts `note_code_sheets`). */
let note_file_load: <T>(url: string, loading: Promise<T>) => Promise<T> = (_url, loading) =>
	loading;
/** The boot hands over what it notes of each island file's load. */
export function on_file_load(note: <T>(url: string, loading: Promise<T>) => Promise<T>): void {
	note_file_load = note;
}

/**
 * `load` (a bundler-resolved `() => import('./x.ts')`), and after it fails to download, its `file`
 * under a fresh URL on each later call; once it has loaded, every later call is that load (a fresh
 * URL after a success would be a second copy of the module). A retry whose own file came and still
 * failed is a dependency's failure, which no URL fixes: from then on every call fails at once with
 * its error, asking nothing. Pair it with `flights()` from `@ogygia/machine`, which calls it again
 * on a failure and never keeps one.
 */
export function import_again<T>(
	load: () => Promise<T>,
	fresh: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
	/** The file `load` imports, resolved against `base`: the build hands each lazy loader its own
	 *  (@ogygia/compiler vite/lazy-files.ts), and an island's caller knows its file. `null` or left out: not known
	 *  (a module that shares its chunk with others), and a failure is loaded the same way again. */
	file?: string | null,
	/** The URL of the module that holds the loader (its `import.meta.url`). */
	base?: string
): () => Promise<T> {
	hear_responses();
	const state = file_definition.create();
	const next = (): Promise<T> => {
		const s = state.now;
		if (s.kind === 'loaded') return s.run as Promise<T>;
		if (s.kind === 'stuck') return Promise.reject(s.error);
		// (a retry that failed is not yet known to be a drop or a dependency's failure: ask once it is)
		if (s.kind === 'failed' && s.verdict) return s.verdict.then(next);
		let run: Promise<T>;
		if (s.kind === 'failed') {
			// (each retry its own URL, counted as it starts: two calls at once ask under two)
			const attempt = s.attempt + 1;
			state.go('failed', { url: s.url, attempt });
			const url = retry_url(s.url, attempt);
			run = (fresh(url) as Promise<T>).catch((error: unknown) => {
				const wait = (verdict?: Promise<void>) => {
					const now = state.now;
					if (now.kind === 'failed')
						state.go('failed', { url: now.url, attempt: now.attempt, verdict });
				};
				// Whether its own file came is read once its timing entry lands (Firefox on a loaded
				// machine: after the import rejects; WebKit gives a dropped download none, so the wait
				// runs out). The caller hears the failure now; a later call waits for the verdict.
				const verdict: Promise<void> = response_landed(url).then((status) => {
					// its own file came, and it still failed: a dependency's failure, which no URL fixes
					if (status !== null && status < 400 && state.move('failed', 'stuck', { error }))
						reload.once('reload', () => say_reload_needed(url, error));
					// (only a failed state holds a verdict)
					else if ((state.now as { verdict?: unknown }).verdict === verdict) wait();
				});
				wait(verdict);
				throw error;
			});
		} else {
			run = load().catch((error: unknown) => {
				const url = file != null && is_failed_import(error) ? file_url(file, base) : null;
				if (url !== null) state.move('fresh', 'failed', { url, attempt: 0 });
				throw error;
			});
		}
		run.then(
			() => {
				if (state.now.kind !== 'loaded') state.go('loaded', { run });
			},
			() => {}
		); // ok: the failure is the caller's: `run` itself is returned and rejects to it
		return run;
	};
	return next;
}

/**
 * One file's loads, as a machine:
 *
 *   fresh ─ failed{url, attempt, verdict} ⟲ ─ loaded{run}
 *     ╲───────────────────────────────────╱ ╲ stuck{error}
 *
 * `fresh`: nothing failed yet (or the loader knows no file): a call loads the bundler's way. `failed`:
 * a download failed; each call asks under a fresh URL, once the last retry's `verdict` (whether its
 * own file came) is in. `loaded`: a load landed, and every later call
 * is that load (a fresh URL after a success would be a second copy of the module). `stuck`: a retry's
 * own file came and it still failed, a dependency's failure: every later call fails at once with it.
 */
const file_definition = machine<{
	fresh: {};
	failed: { url: string; attempt: number; verdict?: Promise<void> };
	loaded: { run: Promise<unknown> };
	stuck: { error: unknown };
}>()({
	name: 'import-again',
	initial: 'fresh',
	steps: {
		fresh: ['failed', 'loaded'],
		failed: ['failed', 'loaded', 'stuck'],
		loaded: [],
		// (a retry already out when another got stuck may still land: the file loaded after all)
		stuck: ['loaded']
	}
});

/** Each file's loader, by URL (an island's own file: its load, and the warm ahead of it): what it
 *  asks for next (the file, or a fresh URL after a failed download). The files this document's
 *  islands came from; past the bound the least recently loaded goes (its next load starts fresh,
 *  and the browser's module map still holds what it loaded). */
const file_loaders = cache<string, () => Promise<unknown>>({
	name: 'island file loaders',
	max: 2000
});

/** One load of each file at a time, kept once it lands: loads of one file that fail together share
 *  one retry, so a failure gets one fresh URL and the module runs once (#271). */
const file_loads = flights({
	name: 'island file',
	run: (url: string) => {
		let again = file_loaders.get(url);
		if (!again)
			file_loaders.set(
				url,
				(again = import_again(() => import(/* @vite-ignore */ url), undefined, url))
			);
		const load = again;
		// (the sheets the file's load puts in the head are the regions' that run it: region-sheets.ts)
		return note_file_load(
			url,
			load().catch(async (error: unknown) => {
				if (!is_failed_import(error)) throw error;
				// (an engine can reject the import before the response's timing entry is in the timeline:
				// Firefox on a loaded machine, by more than one task)
				const status = await response_landed(url);
				if (status === null) return load();
				throw error;
			})
		);
	}
});

/**
 * The module at `url` (an island's own file), through {@link import_again}: a download that fails is
 * asked for again at once under a fresh URL, and by every later load of that file. A plain
 * `import()` of it once left an island whose file dropped one download dead for the tab (#261). A
 * file the server answered for (a 404 after a deploy) is not asked for again at once: the caller's
 * own recovery (./entry-locations.ts, the current build's file) is what helps there.
 */
export function import_file<T>(url: string): Promise<T> {
	// (nothing drops a file's load, so it is never STALE; were it, it is asked for again)
	return file_loads.get(url).then((m) => (m === STALE ? import_file<T>(url) : (m as T)));
}
