import type { TimerHandle } from '../ports.ts';
import { realm } from './realm.ts';

const unref = (timer: unknown): TimerHandle => {
	(timer as { unref?: () => void }).unref?.();
	return timer as TimerHandle;
};

/** A one-shot timer that does not keep a Node process alive. */
export const after = (fn: () => void, ms = 0): TimerHandle => unref(realm.setTimeout(fn, ms));

/** A one-shot timer that keeps a Node process alive: a wait that is work still out. */
export const keep = (fn: () => void, ms = 0): TimerHandle =>
	realm.setTimeout(fn, ms) as TimerHandle;

/** A repeating timer that does not keep a Node process alive. */
export const every = (fn: () => void, ms: number): TimerHandle => unref(realm.setInterval(fn, ms));

/** Ends a timer from `after`, `keep` or `every`. */
export const cancel = (handle: TimerHandle | undefined): void => {
	// (one handle space for both, in every platform ogygia runs on)
	if (handle !== undefined) realm.clearInterval(handle);
};
