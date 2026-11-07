// Machine moves, as the runtime and the server make them: a crowd of machines (one per region on a
// page, one per request on a server) each walked around its lifecycle, with and without data.
import { bench } from '@bench/heisenbench/bench';
import { machine } from '../src/index.ts';

const hole = machine<{
	idle: {};
	fetching: { attempt: number };
	applying: {};
	answered: {};
	failed: { attempt: number };
}>()({
	name: 'hole',
	initial: 'idle',
	steps: {
		idle: ['fetching'],
		fetching: ['applying', 'failed', 'idle'],
		applying: ['answered', 'failed'],
		answered: ['fetching'],
		failed: ['fetching']
	}
});

type Hole = ReturnType<typeof hole.create>;

function crowd(n: number): Hole[] {
	return Array.from({ length: n }, () => hole.create());
}

bench(
	'machine: 200 machines walked through a fetch each',
	({ machines }) => {
		let moved = 0;
		for (const m of machines) {
			if (m.move('idle', 'fetching', { attempt: 1 })) moved++;
			if (m.move('fetching', 'applying')) moved++;
			if (m.move('applying', 'answered')) moved++;
			if (m.go('fetching', { attempt: 2 })) moved++;
			if (m.go('idle')) moved++;
		}
		return moved;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench(
	'machine: moves that lost the race (refused quietly)',
	({ machines }) => {
		let refused = 0;
		for (const m of machines) {
			if (!m.move('fetching', 'applying')) refused++;
			if (!m.move('answered', 'fetching', { attempt: 1 })) refused++;
		}
		return refused;
	},
	{
		setup: () => ({ machines: crowd(200) }),
		scale: (_ctx, k) => ({ machines: crowd(200 * k) })
	}
);

bench('machine: create a machine per region', ({ n }) => crowd(n).length, {
	setup: () => ({ n: 200 }),
	scale: (_ctx, k) => ({ n: 200 * k })
});
