// A definition as data (`graph()`), and the paths that between them take every step (`paths()`):
// what devtools draw, docs show, and a test drives a machine down.
import { describe, expect, it } from 'vitest';
import { machine } from '../src/index.ts';

const hole = machine<{ idle: {}; fetching: {}; answered: {}; failed: {}; gone: {} }>()({
	name: 'hole',
	initial: 'idle',
	steps: {
		idle: ['fetching', 'gone'],
		fetching: ['answered', 'failed', 'idle'],
		answered: ['fetching'],
		failed: ['fetching', 'gone'],
		gone: []
	},
	after: { fetching: { ms: 10_000, to: 'failed' }, failed: { ms: () => 500, to: 'fetching' } }
});

describe('graph()', () => {
	it('every state, its steps, whether it is final, and its own timeout', () => {
		expect(hole.graph()).toEqual({
			name: 'hole',
			initial: 'idle',
			states: [
				{ kind: 'idle', steps: ['fetching', 'gone'], final: false, after: null },
				{
					kind: 'fetching',
					steps: ['answered', 'failed', 'idle'],
					final: false,
					after: { to: 'failed', ms: 10_000 }
				},
				{ kind: 'answered', steps: ['fetching'], final: false, after: null },
				{
					kind: 'failed',
					steps: ['fetching', 'gone'],
					final: false,
					after: { to: 'fetching', ms: null }
				},
				{ kind: 'gone', steps: [], final: true, after: null }
			]
		});
	});

	it('is plain data: it survives JSON (devtools send it over the wire)', () => {
		expect(JSON.parse(JSON.stringify(hole.graph()))).toEqual(hole.graph());
	});
});

describe('paths()', () => {
	it('one path per step, each the shortest that reaches its state and takes it', () => {
		expect(hole.paths()).toEqual([
			['idle', 'fetching'],
			['idle', 'gone'],
			['idle', 'fetching', 'answered'],
			['idle', 'fetching', 'failed'],
			['idle', 'fetching', 'idle'],
			['idle', 'fetching', 'answered', 'fetching'],
			['idle', 'fetching', 'failed', 'fetching'],
			['idle', 'fetching', 'failed', 'gone']
		]);
	});

	it('between them they take every step of the definition', () => {
		const taken = new Set<string>();
		for (const path of hole.paths())
			for (let i = 1; i < path.length; i++) taken.add(`${path[i - 1]}>${path[i]}`);
		const all = hole.graph().states.flatMap((s) => s.steps.map((to) => `${s.kind}>${to}`));
		expect([...taken].sort()).toEqual([...all].sort());
	});

	it('every path can be driven: each move along it is allowed', () => {
		for (const path of hole.paths()) {
			const m = hole.create();
			for (const to of path.slice(1)) expect((m.go as (to: string) => boolean)(to)).toBe(true);
			expect(m.now.kind).toBe(path.at(-1));
			m.stop();
		}
	});
});
