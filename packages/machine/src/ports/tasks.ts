import { after, cancel } from './timers.ts';
import { realm } from './realm.ts';

/** Runs `fn` after the current task's synchronous work. */
export const micro = (fn: () => void): void => realm.queueMicrotask(fn);

/** Runs `fn` before the next paint (the next task where there are no frames); returns its cancel. */
export const frame = (fn: () => void): (() => void) => {
	if (realm.requestAnimationFrame === undefined) return next_task(fn);
	const id = realm.requestAnimationFrame(() => fn());
	return () => realm.cancelAnimationFrame?.(id);
};

/** Runs `fn` in a quiet moment, waiting at most `timeout` ms (the next task where there is no idle
 *  time); returns its cancel. */
export const idle = (fn: () => void, timeout?: number): (() => void) => {
	if (realm.requestIdleCallback === undefined) return next_task(fn);
	const id = realm.requestIdleCallback(fn, timeout === undefined ? undefined : { timeout });
	return () => realm.cancelIdleCallback?.(id);
};

const next_task = (fn: () => void): (() => void) => {
	const handle = after(fn);
	return () => cancel(handle);
};
