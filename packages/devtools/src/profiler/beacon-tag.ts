/**
 * The page beacon as the inline tag the profiler and the devtools server put in a measured
 * document's head. Server side only: the dock's browser code runs `standalone_beacon` itself.
 */
import { script } from '@ogygia/core';
import { OGYGIA_BEACON } from '@ogygia/core/internal/server';
import { standalone_beacon } from './beacon-standalone.ts';

/** The inline tag the profiler and the devtools put in a measured document's head. */
export const BEACON_STANDALONE_TAG: string = script({
	run: standalone_beacon,
	[OGYGIA_BEACON]: true
});
