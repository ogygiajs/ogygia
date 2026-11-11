// The "how it flows" notes (internal/notes/flows) draw each machine from its own graph(): a note
// whose diagram is not the code's fails here (`node internal/checks/flow-graphs.ts` redraws it).
import { describe, expect, it } from 'vitest';
import { FLOWS, flows, redraw } from '../../../internal/checks/flow-graphs.ts';

describe('the flow notes', () => {
	it('draw each machine as its graph() says it is today', () => {
		expect(flows(true)).toEqual([]);
	});

	it('cover a step the code gains, so a drifted note is caught', () => {
		const flow = FLOWS[0];
		const graph = flow.graph();
		const drawn = redraw(`<!-- graph:${flow.name} -->\n<!-- /graph -->`, flow.name, graph);
		const grown = {
			...graph,
			states: graph.states.map((s, i) => (i === 0 ? { ...s, steps: [...s.steps, 'gone'] } : s))
		};
		expect(redraw(drawn, flow.name, grown)).not.toBe(drawn);
	});
});
