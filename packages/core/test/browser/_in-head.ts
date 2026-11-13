// Waits for the held-sheet navigation tests, each bounded on the REAL clock (taken here, before a
// test fakes its timers), so a wait that can no longer end fails naming its step instead of running
// the test into its timeout.
const real_set_timeout = globalThis.setTimeout.bind(globalThis);
const real_clear_timeout = globalThis.clearTimeout.bind(globalThis);

/** `promise`, or a failure naming `what` once `ms` of real time passed. */
export function within<T>(what: string, promise: Promise<T>, ms = 5000): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = real_set_timeout(
			() => reject(new Error(`still waiting after ${ms} ms: ${what}`)),
			ms
		);
		promise.then(
			(value) => {
				real_clear_timeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				real_clear_timeout(timer);
				reject(error);
			}
		);
	});
}

/** The element `selector` names in `<head>`, once it is there (a wait on the mutation, never a
 *  timed poll a loaded runner can run out). */
export function in_head(selector: string): Promise<Element> {
	const now = document.head.querySelector(selector);
	if (now) return Promise.resolve(now);
	let seen: MutationObserver | undefined;
	const there = new Promise<Element>((resolve) => {
		seen = new MutationObserver(() => {
			const el = document.head.querySelector(selector);
			if (el) resolve(el);
		});
		seen.observe(document.head, { childList: true, subtree: true });
	});
	return within(`${selector} in <head>`, there, 8000).finally(() => seen?.disconnect());
}

/** `link`'s sheet, once it has one: read on the real clock, so neither a load event that fired
 *  before anyone listened nor one that never fires (an error) can hang the wait. */
export function sheet_loaded(link: HTMLLinkElement, ms = 5000): Promise<CSSStyleSheet> {
	const until = performance.now() + ms;
	return new Promise((resolve, reject) => {
		const look = () => {
			if (link.sheet) resolve(link.sheet);
			else if (performance.now() > until)
				reject(new Error(`still waiting after ${ms} ms: ${link.getAttribute('href')} loaded`));
			else real_set_timeout(look, 10);
		};
		look();
	});
}
