/**
 * The page's early hole requests, taken over at boot (the head started them: ../early-holes.ts).
 *
 * @packageDocumentation
 */
import { scope, type Scope } from '@ogygia/machine';
import { EARLY_HOLES_KEY, type EarlyHole } from '../early-holes.ts';
import { frameAddress } from '../frame.ts';
import { ensure, hold_refusal, renew } from './frame-store.ts';
import { read_hole } from './hole-fetch.ts';

const PARKED = Symbol.for(EARLY_HOLES_KEY);
type Host = { [PARKED]?: readonly EarlyHole[] };

/**
 * Take the parked requests over, once (the global is emptied). Each becomes the flight at its
 * frame-store address, its response read the way every hole answer is (./hole-fetch.ts
 * `read_hole`): the hole's own wake joins it, a batch leaves the address out, and the response is
 * read once. `visit` is its first caller, so a request nobody joined is cancelled with the visit;
 * a refused answer waits at its address for the hole that asks.
 */
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
				// @why its last caller leaving cancels the request in the network (test: test/browser/early-holes.test.ts › that nobody joins, left before its answer lands: cancelled in the network, nothing written, nothing unhandled)
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
		).catch((err: unknown) => hold_refusal(address, err)); // ok: a refused answer waits at its address for the hole that asks; any other failure is never kept, and the hole's own wake asks again and says it
	}
}
