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
 * Every port is a thin forward: no state, no allocation beyond the platform's own. Each is a
 * module of functions re-exported as a namespace (`timers.after`), so a bundle keeps only the
 * functions it calls. The clock is the one object: two functions, which a test may spy on.
 */
import * as clock_port from './ports/clock.ts';

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

declare const TIMER: unique symbol;
/** A timer's handle (opaque: what the platform gave). */
export type TimerHandle = { readonly [TIMER]: true };

/** The two clocks (#472): `mono()` for a duration inside one process (it never steps), `wall()`
 *  for a timestamp that leaves the process or is compared with one from outside. */
// (an object, not a module namespace: a test steps `clock.mono` with a spy, which a browser's ESM
// namespace refuses; test/clock.test.ts in three engines)
export const clock: { readonly mono: () => number; readonly wall: () => number } = {
	mono: clock_port.mono,
	wall: clock_port.wall
};
/** Timers: `after` (one-shot), `keep` (one that keeps a Node process alive), `every`, `cancel`,
 *  `timeout` (an abort signal on them). */
export * as timers from './ports/timers.ts';
/** The browser's task hooks: `micro`, `frame`, `idle` (each falls back to the next task). */
export * as tasks from './ports/tasks.ts';
/** Randomness: `float`, `bytes`, `uuid`. */
export * as random from './ports/random.ts';
/** The network: `fetch`, `stream` (server-sent events). */
export * as net from './ports/net.ts';
/** What is on screen: `observer` (an IntersectionObserver, or null). */
export * as seen from './ports/seen.ts';
/** Storage: `local`, `session` (null where there is none or it is blocked). */
export * as storage from './ports/storage.ts';
