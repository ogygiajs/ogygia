/**
 * THE PAGE'S EARLY HOLE REQUESTS, TAKEN OVER (../early-holes.ts). The head started each `load`
 * hole's request during the parse and parked it on one global; at boot each becomes the flight at
 * its frame-store address, its response read the one way every hole answer is (./hole-fetch.ts
 * `read_hole`). The hole's own wake joins that flight, a batch finds the address in flight and
 * leaves it out, and the response is read once. The flight's first caller is the page visit, and
 * the flight's signal cancels the parked request: one nobody joined is cancelled with the visit.
 * Part of the frames feature (./frames.ts): no hole, no code.
 */
import { scope, type Scope } from '@ogygia/machine';
import { EARLY_HOLES_KEY, type EarlyHole } from '../early-holes.ts';
import { frameAddress } from '../frame.ts';
import { ensure, renew } from './frame-store.ts';
import { read_hole } from './hole-fetch.ts';

const PARKED = Symbol.for(EARLY_HOLES_KEY);
type Host = { [PARKED]?: readonly EarlyHole[] };

/** Take the parked requests over, once (the global is emptied): each the flight at its address,
 *  with `visit` its first caller. */
export function adopt_early_holes(visit: Scope): void {
	const host = globalThis as Host;
	const parked = host[PARKED];
	if (!parked) return;
	delete host[PARKED];
	for (const { url, response, controller } of parked) {
		const address = frameAddress(url);
		ensure(
			address,
			async (signal) => {
				// (the flight's signal is the request's: its last caller leaving cancels it in the network)
				const tie = scope();
				tie.on(signal, 'abort', () => controller.abort(signal.reason));
				try {
					return await read_hole(url, response, {
						signal,
						renewed: (fresh) => renew(address, fresh)
					});
				} finally {
					tie.close();
				}
			},
			{ signal: visit.signal }
		).catch(() => {}); // ok: an answer refused stays at its address; any other failure is never kept, and the hole's own wake asks again and says it
	}
}
