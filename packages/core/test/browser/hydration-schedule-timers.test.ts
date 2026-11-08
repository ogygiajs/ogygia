// THE SCHEDULER'S WAKE-UP (runtime/schedule.ts `drain_after`), in a real browser with real timers.
// A drain that cannot hand out a turn yet sets one timer to look again: the short wait for a
// region's viewport snapshot (48 ms), or the hold of a ready island below the fold while a viewport
// island loads (up to 1000 ms). One timer at a time, so the one kept must be the EARLIEST: a short
// wait set after a long hold must not wait out the hold.
//
// The regions: `top` is in the viewport and its module is on its way (hydrate_started); `low` is
// below the fold and ready; `late` asks for a turn without a snapshot (a stalled observer: it was
// never registered, so the drain waits its 48 ms, then goes on without it).
import { afterEach, expect, test } from 'vitest';
import {
	hydrate_started,
	hydrate_turn,
	register_region,
	unregister_region
} from '../../src/runtime/schedule.ts';

const made: Element[] = [];

function region(where: 'top' | 'low'): Element {
	const el = document.createElement('div');
	el.style.cssText =
		where === 'top'
			? 'position:absolute;top:0;left:0;width:10px;height:10px'
			: 'position:absolute;top:30000px;left:0;width:10px;height:10px';
	document.body.append(el);
	made.push(el);
	return el;
}

/** Resolves once the observer has reported on every region (in the viewport or not). */
async function snapshots(): Promise<void> {
	await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50)));
}

/** When a turn was handed out, in ms after `t0`. */
function timed(turn: Promise<void>, t0: number): Promise<number> {
	return turn.then(() => performance.now() - t0);
}

afterEach(() => {
	for (const el of made.splice(0)) {
		unregister_region(el);
		el.remove();
	}
});

test('a short snapshot wait set after a long hold wakes the drain at its own time', async () => {
	const top = region('top');
	const low = region('low');
	register_region(top);
	register_region(low);
	await snapshots();
	hydrate_started(top); // a viewport island still loads its module
	const t0 = performance.now();
	const low_turn = timed(hydrate_turn(low), t0); // ready below the fold: held up to 1000 ms
	await new Promise((r) => setTimeout(r, 20));
	// a region with no snapshot asks for its turn: the drain waits 48 ms for its report
	const late = document.createElement('div');
	document.body.append(late);
	made.push(late);
	const late_turn = timed(hydrate_turn(late), t0);
	// the viewport island's module lands: it is the best turn, once the snapshot wait is over
	const top_turn = timed(hydrate_turn(top), t0);
	const at = await top_turn;
	expect(at, `the viewport island's turn came at ${Math.round(at)} ms`).toBeLessThan(400);
	await Promise.all([low_turn, late_turn]);
});

test('a long hold set after a short wait ran out still ends at its own deadline', async () => {
	const top = region('top');
	const low = region('low');
	register_region(top);
	register_region(low);
	await snapshots();
	hydrate_started(top); // loads, and never takes its turn in this test
	const t0 = performance.now();
	// no snapshot for `late`: 48 ms first; then the hold for the ready ones below the fold
	const late = document.createElement('div');
	document.body.append(late);
	made.push(late);
	const late_turn = timed(hydrate_turn(late), t0);
	const low_turn = timed(hydrate_turn(low), t0);
	const [late_at, low_at] = await Promise.all([late_turn, low_turn]);
	// held for the viewport island, bounded: both go at the hold's end (1000 ms), not before it,
	// and not much after it
	for (const at of [late_at, low_at]) {
		expect(at).toBeGreaterThanOrEqual(950);
		expect(at).toBeLessThan(1600);
	}
});
