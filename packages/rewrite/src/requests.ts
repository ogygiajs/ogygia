import { slot as shared } from '@ogygia/machine';
import type { Step } from './pass.ts';

/** The rewrites of each request, and the requests ogygia's handle has started. */
export interface Slot {
	live: boolean;
	by_request: WeakMap<Request, Step[]>;
	started: WeakSet<Request>;
}

/** One global slot, not module scope: the handle (the package's root) and the server realm (named
 *  by `rewrite()`) can be two module instances of this file (src beside dist), and a step filed
 *  through one is read through the other. */
export const slot: Slot = shared<Slot>({
	name: 'ogygia.rewrite',
	version: 1,
	make: () => ({ live: false, by_request: new WeakMap(), started: new WeakSet() })
});
