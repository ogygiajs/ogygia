/**
 * PORTS: every source of nondeterminism a package reaches, named once. Time, timers, the browser's
 * task hooks (a frame, an idle moment, a microtask), randomness, the network, storage and what is
 * on screen all go through here; package source calls none of them raw (`ogygia/ports`, the lint
 * rule in internal/lint/plugin.ts, says so at the call).
 *
 * Each port reads its realm's platform when called, never when the module loads. That is the seam
 * a simulated run uses (internal/sim): it gives each tab and each server its own platform (a virtual
 * clock and timers, a network it owns, seeded randomness), so these ports, and Svelte's and Kit's
 * own calls beside them, all play the one seed. A port that swapped only ogygia's calls would leave
 * Kit's real, and the run would not replay. `Platform` is the contract the simulated one implements
 * (internal/sim/src/platform.ts), type-checked against this file.
 *
 * Dynamic `import()` is not a port: a realm's module loader fetches its chunks, so the network port
 * carries them (a simulated tab's loader goes through the simulated network).
 *
 * Every port here is a thin forward: no state, no allocation beyond the platform's own.
 */

/** The platform a port reads (a browser window, a Node process, or a simulated tab or server). */
export interface Platform {
	setTimeout(fn: () => void, ms?: number): unknown;
	clearTimeout(handle: unknown): void;
	setInterval(fn: () => void, ms?: number): unknown;
	clearInterval(handle: unknown): void;
	queueMicrotask(fn: () => void): void;
	requestAnimationFrame?(fn: (t: number) => void): number;
	cancelAnimationFrame?(id: number): void;
	requestIdleCallback?(fn: () => void, options?: { timeout?: number }): number;
	cancelIdleCallback?(id: number): void;
	performance?: { now(): number };
	Date: { now(): number };
	Math: { random(): number };
	crypto?: { getRandomValues<T extends ArrayBufferView>(array: T): T; randomUUID?(): string };
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
	EventSource?: new (url: string | URL, init?: EventSourceInit) => EventSource;
	IntersectionObserver?: new (
		callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit
	) => IntersectionObserver;
	localStorage?: Storage;
	sessionStorage?: Storage;
}

const realm = (): Platform => globalThis as unknown as Platform;

/**
 * The two clocks (#472):
 *
 * - `clock.mono()`: milliseconds on the monotonic clock, for every duration inside one process (a
 *   TTL, a deadline, a time budget, a wait). It never steps: an NTP correction, a VM resume or a
 *   laptop waking moves the wall clock, not this one. Its zero is the process's (or the page's)
 *   start, so a reading means nothing outside this process.
 * - `clock.wall()`: milliseconds since the epoch, for a timestamp that leaves the process (a log
 *   line, a header, a stored date) or is compared with one that came from outside.
 */
export const clock = {
	mono: (): number => {
		const p = realm().performance;
		return p !== undefined ? p.now() : realm().Date.now();
	},
	wall: (): number => realm().Date.now()
} as const;

declare const TIMER: unique symbol;
/** A timer's handle (opaque: what the platform gave). */
export type TimerHandle = { readonly [TIMER]: true };

/**
 * Timers. `after` is a one-shot, `every` repeats; `cancel` ends either. A timer set here does not
 * keep a Node process alive (`unref`): a server shutting down does not wait for one. `keep` is the
 * exception, for a wait that is work still out (a retry's backoff).
 */
export const timers = {
	after: (fn: () => void, ms = 0): TimerHandle => unref(realm().setTimeout(fn, ms)),
	keep: (fn: () => void, ms = 0): TimerHandle => realm().setTimeout(fn, ms) as TimerHandle,
	every: (fn: () => void, ms: number): TimerHandle => unref(realm().setInterval(fn, ms)),
	cancel: (handle: TimerHandle | undefined): void => {
		if (handle === undefined) return;
		// (one handle space for both in every platform ogygia runs on)
		realm().clearTimeout(handle);
		realm().clearInterval(handle);
	}
} as const;

function unref(timer: unknown): TimerHandle {
	(timer as { unref?: () => void }).unref?.();
	return timer as TimerHandle;
}

/**
 * The browser's task hooks. `frame` runs before the next paint, `idle` when the page has a quiet
 * moment (`timeout` caps the wait), `micro` after the current task. Where there are no frames or no
 * idle time (a server, a worker, a browser without it) each falls back to the next task; the
 * returned function cancels it either way.
 */
export const tasks = {
	micro: (fn: () => void): void => realm().queueMicrotask(fn),
	frame: (fn: () => void): (() => void) => {
		const p = realm();
		if (p.requestAnimationFrame === undefined) return after_task(fn, 0);
		const id = p.requestAnimationFrame(() => fn());
		return () => p.cancelAnimationFrame?.(id);
	},
	idle: (fn: () => void, timeout?: number): (() => void) => {
		const p = realm();
		if (p.requestIdleCallback === undefined) return after_task(fn, 0);
		const id = p.requestIdleCallback(fn, timeout === undefined ? undefined : { timeout });
		return () => p.cancelIdleCallback?.(id);
	}
} as const;

function after_task(fn: () => void, ms: number): () => void {
	const handle = timers.after(fn, ms);
	return () => timers.cancel(handle);
}

/** Randomness: a float in [0, 1), fresh random bytes, and a v4 UUID. */
export const random = {
	float: (): number => realm().Math.random(),
	bytes: (n: number): Uint8Array => {
		const out = new Uint8Array(n);
		const c = realm().crypto;
		if (c !== undefined) return c.getRandomValues(out);
		for (let i = 0; i < n; i++) out[i] = Math.floor(realm().Math.random() * 256);
		return out;
	},
	uuid: (): string => {
		const c = realm().crypto;
		if (c?.randomUUID !== undefined) return c.randomUUID();
		const b = random.bytes(16);
		b[6] = (b[6] & 0x0f) | 0x40;
		b[8] = (b[8] & 0x3f) | 0x80;
		const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
		return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
	}
} as const;

/** The network: a request, and a live stream of server-sent events. */
export const net = {
	fetch: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
		realm().fetch(input, init),
	stream: (url: string | URL, init?: EventSourceInit): EventSource => {
		const E = realm().EventSource;
		if (E === undefined) throw new TypeError('no EventSource on this platform');
		return new E(url, init);
	}
} as const;

/** What is on screen: an IntersectionObserver, or null where there is none (a server). */
export const seen = {
	observer: (
		callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit
	): IntersectionObserver | null => {
		const IO = realm().IntersectionObserver;
		return IO === undefined ? null : new IO(callback, options);
	}
} as const;

/**
 * Storage: the page's local or session storage, or null where there is none or it may not be read
 * (a server, a sandboxed frame, storage blocked by the browser's settings).
 */
export const storage = {
	local: (): Storage | null => {
		try {
			return realm().localStorage ?? null;
		} catch {
			// ok: reading it throws where storage is blocked; null is "no storage here"
			return null;
		}
	},
	session: (): Storage | null => {
		try {
			return realm().sessionStorage ?? null;
		} catch {
			// ok: reading it throws where storage is blocked; null is "no storage here"
			return null;
		}
	}
} as const;
