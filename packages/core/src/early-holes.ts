/**
 * THE EARLY START OF A HOLE THAT LOADS AT ONCE. A `defer: 'load'` hole's request starts during the
 * HTML parse, before the runtime is in, so its answer is on its way when the hole wakes. The page's
 * head carries one data block (the endpoints, JSON: no CSP allowance needed) and one inline script
 * that is the same bytes on every page ({@link start_early_holes}): it starts each `fetch` as the
 * runtime's hole fetch would (./runtime/hole-fetch.ts) and parks the requests by resolved URL on one
 * global. The runtime takes them over as the frame store's flights (./runtime/early-holes.ts), so
 * each hole is asked for once. (A `<link rel="preload" as="fetch">` did the early start before:
 * WebKit never hands one to a later `fetch()`, and every hole was asked for, and rendered, twice
 * there: #404.)
 *
 * The script never changes, so its hash is a constant: a policy that would block it gets that hash
 * (./server/early-holes-csp.ts, computed from the text ./early-holes-head.ts writes). Universal and
 * import-free: the runtime reads the global through it.
 */

/** The id of the head's data block: the `load` holes' endpoints, as rendered. */
export const EARLY_HOLES_ID = 'ogygia-early-holes';

/** The `Symbol.for` name of the global the script parks its requests on (a list of
 *  {@link EarlyHole}), until the runtime takes them over. */
export const EARLY_HOLES_KEY = 'ogygia.early-holes';

/** One request the head started: the hole's endpoint, resolved, the `fetch` that asks for it, and
 *  the controller that cancels it (the flight that takes it over owns it). */
export type EarlyHole = { url: string; response: Promise<Response>; controller: AbortController };

/**
 * The early start, run inline in the head (`script()` writes its source: self-contained, browser
 * globals only). Each endpoint in the data block is resolved against the document's base, as the
 * runtime resolves it, and asked for once. A request that fails is the runtime's to say when it
 * takes it over: the park only keeps its rejection from reading as unhandled.
 */
export function start_early_holes(id: string, key: string): void {
	const data = document.getElementById(id);
	if (!data) return;
	// (the requests as they started, in a list: the runtime makes each the one flight at its address)
	const parked: EarlyHole[] = [];
	const asked = new Set<string>();
	for (const endpoint of JSON.parse(data.textContent || '[]') as string[]) {
		const url = new URL(endpoint, document.baseURI).href;
		if (asked.has(url)) continue;
		asked.add(url);
		const controller = new AbortController();
		// oxlint-disable-next-line ogygia/ports -- this function's source is an inline head script (no imports, a fixed CSP hash)
		const response = fetch(url, { credentials: 'same-origin', signal: controller.signal });
		// oxlint-disable-next-line ogygia/no-silent-failures -- the runtime says the failure when it takes the request over
		response.catch(() => {});
		parked.push({ url, response, controller });
	}
	(globalThis as Record<symbol, unknown>)[Symbol.for(key)] = parked;
}
