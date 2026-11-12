/**
 * The process-wide federation slot. `federate()` registers the app's ONE identity here; the handle
 * (`/og/fragment/*`, `/og/thaw`, remote-region capabilities), the postrender registry (thaw notices on
 * invalidate) and the peers themselves read it back. `globalThis` + `Symbol.for` — the
 * PAGE-STATE-SINGLETON law (dist entries can double-evaluate a module); a second `federate()` call
 * (dev re-evaluation of the module that owns it) REPLACES the previous one.
 */
import type { Federation } from './types.ts';
import { slot as shared } from '@ogygia/machine';

interface Slot {
	current: Federation | null;
}

const slot = shared<Slot>({
	name: 'ogygia.federation',
	version: 1,
	make: () => ({ current: null })
});

export function set_federation(f: Federation | null): void {
	slot.current = f;
}

export function current_federation(): Federation | null {
	return slot.current;
}
