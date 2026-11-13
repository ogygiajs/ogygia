/**
 * Which requests run rewrites, and which: each `rewrite()` handle adds its step to the request it
 * wraps, and the server realm reads the list there when ogygia asks. A request that went through
 * no rewrite handle has no pass.
 *
 * One global slot, not module scope: the handle (from the package's root) and the server realm (named
 * by `rewrite()`) can end up as two module instances of this file (src beside dist), and a step
 * filed through one must be read through the other.
 */
import { slot as shared } from '@ogygia/machine';
import type { Step } from './pass.ts';

/** The rewrites of each request, and the requests ogygia's handle has started. */
export interface Slot {
	live: boolean;
	by_request: WeakMap<Request, Step[]>;
	started: WeakSet<Request>;
}

export const slot: Slot = shared<Slot>({
	name: 'ogygia.rewrite',
	version: 1,
	make: () => ({ live: false, by_request: new WeakMap(), started: new WeakSet() })
});
