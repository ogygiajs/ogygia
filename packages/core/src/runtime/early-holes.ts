/**
 * THE PAGE'S EARLY HOLE REQUESTS, TAKEN OVER (../early-holes.ts). The head started each `load`
 * hole's request during the parse and parked it on one global; at boot each becomes the flight at
 * its frame-store address, read through the one hole fetch (./hole-fetch.ts). The hole's own wake
 * joins that flight, a batch finds the address in flight and leaves it out, and the response is
 * read once. The flight's first caller is the page visit: one nobody joined is aborted with it,
 * its download cancelled. Part of the frames feature (./frames.ts): no hole, no code.
 */
import type { Scope } from '@ogygia/machine';
import { EARLY_HOLES_KEY, type EarlyHole } from '../early-holes.ts';
import { frameAddress } from '../frame.ts';
import { ensure, renew } from './frame-store.ts';
import { fetch_hole } from './hole-fetch.ts';

const PARKED = Symbol.for(EARLY_HOLES_KEY);
type Host = { [PARKED]?: readonly EarlyHole[] };

/** Take the parked requests over, once (the global is emptied): each the flight at its address,
 *  with `visit` its first caller. */
export function adopt_early_holes(visit: Scope): void {
	const host = globalThis as Host;
	const parked = host[PARKED];
	if (!parked) return;
	delete host[PARKED];
	for (const { url, response } of parked) {
		const address = frameAddress(url);
		ensure(
			address,
			(signal) =>
				fetch_hole(url, { early: response, signal, renewed: (fresh) => renew(address, fresh) }),
			{ signal: visit.signal }
		).catch(() => {}); // ok: a flight's failure is never kept: the hole's own wake asks again and says it
	}
}
