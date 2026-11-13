// Waits on the thing itself, never on a clock: the test's own timeout is the only budget, so a busy
// machine makes a test slower, never red (#1430).

const real = {
	setTimeout: globalThis.setTimeout.bind(globalThis),
	clearTimeout: globalThis.clearTimeout.bind(globalThis),
	clearInterval: globalThis.clearInterval.bind(globalThis)
};

/** A timer set while time was held: armed on the real clock, with its whole delay, at release. */
class HeldTimer {
	real: ReturnType<typeof setTimeout> | null = null;
	constructor(
		readonly run: () => void,
		readonly ms: number
	) {}
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
 * delay. For a check made while the code under test waits with a cap (the router's 2 s sheet cap):
 * on a wall clock, a loaded machine let the cap fire first, and the page moved on under the check
 * (#1430). Nothing is dropped: the page's other timers (a cache entry's expiry) are only late.
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

/** The first element under `root` that matches `selector`: now, or once one is put in. */
export function appears<E extends Element = Element>(
	selector: string,
	root: ParentNode & Node = document
): Promise<E> {
	const now = root.querySelector<E>(selector);
	if (now) return Promise.resolve(now);
	return new Promise((resolve) => {
		const watch = new MutationObserver(() => {
			const found = root.querySelector<E>(selector);
			if (!found) return;
			watch.disconnect();
			resolve(found);
		});
		watch.observe(root, { childList: true, subtree: true });
	});
}

/** A stylesheet link's sheet once it has loaded: at once if it has, else on its `load` event. A
 *  failed load rejects, so the test says why. */
export function sheet_loaded(link: HTMLLinkElement): Promise<CSSStyleSheet> {
	if (link.sheet) return Promise.resolve(link.sheet);
	return new Promise((resolve, reject) => {
		const done = new AbortController();
		link.addEventListener(
			'load',
			() => {
				done.abort();
				if (link.sheet) resolve(link.sheet);
				else reject(new Error(`${link.href} loaded without a sheet`));
			},
			{ signal: done.signal }
		);
		link.addEventListener(
			'error',
			() => {
				done.abort();
				reject(new Error(`${link.href} failed to load`));
			},
			{ signal: done.signal }
		);
	});
}
