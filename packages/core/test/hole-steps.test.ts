// Every step the hole machine declares is one the element takes (runtime/core.ts), and each says
// where. A declared step no code takes widens what `go()` allows: a wrong move would pass the step
// check instead of being refused (#1016: `retrying -> failed`).
import { describe, expect, it } from 'vitest';
import { hole_graph } from '../src/runtime/region-machines.ts';

/** Each step, and where `OgygiaRegion` takes it. */
const TAKEN: Record<string, string> = {
	'idle -> armed': '#hole_armed: a schedule is set',
	'idle -> fetching': '#fetch_html: a refresh, or a schedule that fires at once',
	'armed -> idle': '#answered (an answer came another way), #server (nothing to fetch)',
	'armed -> fetching': '#fetch_html: the schedule fired',
	'fetching -> idle':
		'#fetch_html (its answer), #bind (re-minted), #fetch_failed (an answer stands)',
	'fetching -> retrying': '#fetch_failed: tries left, nothing on screen',
	'fetching -> offline': '#fetch_failed: no response while the browser is offline',
	'fetching -> failed': '#fetch_failed: refused, or out of tries',
	'retrying -> idle': '#answered: an answer came while it waited',
	'retrying -> armed': '#hole_armed: the retry connects again and arms its schedule',
	'retrying -> fetching': '#fetch_html: the retry fetches',
	'offline -> idle': '#answered: an answer came while it waited for the network',
	'offline -> armed': '#hole_armed: back online, it connects again and arms its schedule',
	'offline -> fetching': '#fetch_html: back online, it fetches',
	'failed -> idle': '#answered: an answer came another way',
	'failed -> armed': '#hole_armed: a new schedule',
	'failed -> fetching': '#fetch_html: a refresh'
};

describe('the hole machine', () => {
	it('declares only the steps the element takes', () => {
		const declared = hole_graph().states.flatMap((s) => s.steps.map((to) => `${s.kind} -> ${to}`));
		expect(declared.sort()).toEqual(Object.keys(TAKEN).sort());
	});
});
