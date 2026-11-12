// Every step a machine declares is one its code takes, and each says where. A declared step no code
// takes widens what `go()` allows: a wrong move would pass the step check instead of being refused
// (#1016: hole `retrying -> failed`; #1023: batch-stream `-> ended`, hydrate-drain
// `waiting -> waiting`, wake `cold -> waking`). A machine made by `flights()` is not here: its steps
// are the primitive's own, taken by other flights.
import { describe, expect, it } from 'vitest';
import type { MachineGraph } from '@ogygia/machine';
import { batch_stream_graph } from '../src/runtime/frame-nav.ts';
import { hole_graph, wake_graph } from '../src/runtime/region-machines.ts';
import { drain_graph } from '../src/runtime/schedule.ts';

/** Each machine: its graph, and each step with where it is taken. */
const MACHINES: { graph: () => MachineGraph; taken: Record<string, string> }[] = [
	{
		// runtime/core.ts `OgygiaRegion`
		graph: hole_graph,
		taken: {
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
		}
	},
	{
		// runtime/core.ts `OgygiaRegion`: a wake starts only from `armed` (every fire runs there)
		graph: wake_graph,
		taken: {
			'cold -> armed': '#connect (its schedule), #arm_phase2 (a deferred island answered)',
			'armed -> cold': 'disconnectedCallback: the region left the page',
			'armed -> waking': '#hydrate: its schedule or a visitor fired',
			'waking -> cold': '#hydrate (no island to keep), disconnectedCallback',
			'waking -> awake': '#hydrate: hydrated',
			'waking -> offline': '#wake_online: its code failed to download offline',
			'waking -> failed': '#hydrate: hydrating threw',
			'awake -> cold': 'disconnectedCallback',
			'offline -> cold': 'disconnectedCallback',
			'offline -> armed': '#wake_online: back online',
			'failed -> cold': 'disconnectedCallback'
		}
	},
	{
		// runtime/frame-nav.ts `streamFrames`: its end is the machine's stop, not a step
		graph: batch_stream_graph,
		taken: {
			'sending -> reading': 'streamFrames: the answer started',
			'sending -> stalled': 'after: no answer for the stream deadline',
			'reading -> reading': 'streamFrames: a read brought bytes',
			'reading -> stalled': 'after: quiet for the stream deadline'
		}
	},
	{
		// runtime/schedule.ts
		graph: drain_graph,
		taken: {
			'idle -> queued': 'schedule_drain: a turn was asked for',
			'idle -> waiting': 'drain_after, from drain (which moved to idle first)',
			'queued -> idle': 'drain: its task came',
			'waiting -> queued': "schedule_drain: the wait's timer, or a turn asked for meanwhile"
		}
	}
];

describe('each machine', () => {
	for (const { graph, taken } of MACHINES) {
		const g = graph();
		const steps = g.states.flatMap((s) =>
			s.steps
				.map((to) => `${s.kind} -> ${to}`)
				.concat(s.after ? [`${s.kind} -> ${s.after.to}`] : [])
		);
		it(`${g.name}: declares only the steps its code takes`, () => {
			expect([...new Set(steps)].sort()).toEqual(Object.keys(taken).sort());
		});
	}
});
