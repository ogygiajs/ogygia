// Waits for the held-sheet navigation tests: each waits on the thing itself, never on a clock, so a
// loaded runner makes a test slower, never red (the test's own timeout is the only budget: #1430).

/** The element `selector` names in `<head>`: now, or once it is put in (a wait on the mutation). */
export function in_head(selector: string): Promise<Element> {
	const now = document.head.querySelector(selector);
	if (now) return Promise.resolve(now);
	return new Promise((resolve) => {
		const seen = new MutationObserver(() => {
			const el = document.head.querySelector(selector);
			if (!el) return;
			seen.disconnect();
			resolve(el);
		});
		seen.observe(document.head, { childList: true, subtree: true });
	});
}

/** `link`'s sheet once it has loaded: at once if it has, else on its `load` event. A failed load
 *  rejects, so the test says why. */
export function sheet_loaded(link: HTMLLinkElement): Promise<CSSStyleSheet> {
	if (link.sheet) return Promise.resolve(link.sheet);
	return new Promise((resolve, reject) => {
		const done = new AbortController();
		const href = link.getAttribute('href');
		link.addEventListener(
			'load',
			() => {
				done.abort();
				if (link.sheet) resolve(link.sheet);
				else reject(new Error(`${href} loaded without a sheet`));
			},
			{ signal: done.signal }
		);
		link.addEventListener(
			'error',
			() => {
				done.abort();
				reject(new Error(`${href} failed to load`));
			},
			{ signal: done.signal }
		);
	});
}

/** Lets `link`'s held download go (`release`), then waits until it has ended, loaded or failed (a
 *  held test sheet is no real file: a 404), as the router's own wait on it ends. The listeners go
 *  on before the release: a one-shot `error` that fired during the release's round trip was
 *  missed, and the wait hung. */
export async function release_download(
	link: HTMLLinkElement,
	release: () => Promise<unknown>
): Promise<void> {
	if (link.sheet) return void (await release());
	const done = new AbortController();
	const ended = new Promise<void>((resolve) => {
		const end = () => {
			done.abort();
			resolve();
		};
		link.addEventListener('load', end, { signal: done.signal });
		link.addEventListener('error', end, { signal: done.signal });
	});
	await release();
	await ended;
}

const real = {
	setTimeout: globalThis.setTimeout.bind(globalThis),
	clearTimeout: globalThis.clearTimeout.bind(globalThis),
	clearInterval: globalThis.clearInterval.bind(globalThis)
};

/** A timer set while time was held: armed on the real clock, with its whole delay, at release. */
class HeldTimer {
	real: ReturnType<typeof setTimeout> | null = null;
	readonly run: () => void;
	readonly ms: number;
	constructor(run: () => void, ms: number) {
		this.run = run;
		this.ms = ms;
	}
}

/** The timers set since `hold_time`, or null while time moves. */
let held: Set<HeldTimer> | null = null;

const cancel = (handle: unknown): void => {
	if (!(handle instanceof HeldTimer)) return real.clearInterval(handle as number);
	held?.delete(handle);
	if (handle.real !== null) real.clearTimeout(handle.real);
};

/**
 * Stops the page's clock: a timer set from here on waits for `release_time`, then runs its whole
 * delay. For checks made while the router waits on a sheet with its 2 s cap: on a wall clock, a
 * loaded runner let the cap fire first, and the page swapped in under the check. Nothing is dropped
 * (Vitest's fake timers drop what is pending when they end, and a navigation that ends on a
 * dropped timer never settles): the page's other timers are only late.
 */
export function hold_time(): void {
	held = new Set();
	globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
		if (held === null) return real.setTimeout(fn, ms, ...args);
		const timer = new HeldTimer(() => fn(...args), ms);
		held.add(timer);
		return timer;
	}) as typeof setTimeout;
	globalThis.clearTimeout = cancel as typeof clearTimeout;
	globalThis.clearInterval = cancel as typeof clearInterval;
}

/** Starts the clock again: each timer set while it was held is armed now. */
export function release_time(): void {
	const was = held ?? new Set<HeldTimer>();
	held = null;
	for (const timer of was) timer.real = real.setTimeout(timer.run, timer.ms);
}

/** The page's own timers again (an `afterEach`: a test that failed while time was held). */
export function end_time_hold(): void {
	release_time();
	globalThis.setTimeout = real.setTimeout;
	globalThis.clearTimeout = real.clearTimeout;
	globalThis.clearInterval = real.clearInterval;
}
