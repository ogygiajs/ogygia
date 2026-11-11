// trace(): every machine move as one short line, numbered per machine, bounded, and gone quiet
// once stopped.
import { afterEach, describe, expect, it } from 'vitest';
import { machine, trace, type Trace } from '../src/index.ts';

const visit = machine<{ idle: {}; loading: {}; answered: {} }>()({
	name: 'visit',
	initial: 'idle',
	steps: { idle: ['loading'], loading: ['answered', 'idle'], answered: ['loading'] }
});
const hole = machine<{ idle: {}; fetching: {} }>()({
	name: 'hole',
	initial: 'idle',
	steps: { idle: ['fetching'], fetching: ['idle'] }
});

let t: Trace | undefined;
afterEach(() => t?.stop());

describe('trace()', () => {
	it('writes each move as `name#n from -> to`, numbering each machine per name as it first moves', () => {
		t = trace();
		const a = visit.create();
		const b = visit.create();
		const h = hole.create();
		b.go('loading');
		a.go('loading');
		h.go('fetching');
		b.go('answered');
		expect(t.lines()).toEqual([
			'visit#1 idle -> loading',
			'visit#2 idle -> loading',
			'hole#1 idle -> fetching',
			'visit#1 loading -> answered'
		]);
	});

	it('writes `stopped` when a machine stops', () => {
		t = trace();
		const a = visit.create();
		a.go('loading');
		a.stop();
		expect(t.lines()).toEqual(['visit#1 idle -> loading', 'visit#1 loading -> stopped']);
	});

	it('keeps the last `max` lines and says how many it let go', () => {
		t = trace({ max: 2 });
		const a = visit.create();
		a.go('loading');
		a.go('answered');
		a.go('loading');
		expect(t.lines()).toEqual(['visit#1 loading -> answered', 'visit#1 answered -> loading']);
		expect(t.text()).toBe(
			'(1 earlier moves let go)\nvisit#1 loading -> answered\nvisit#1 answered -> loading'
		);
	});

	it('records only the names `only` accepts', () => {
		t = trace({ only: (name) => name === 'hole' });
		visit.create().go('loading');
		hole.create().go('fetching');
		expect(t.lines()).toEqual(['hole#1 idle -> fetching']);
	});

	it('hears nothing after stop(), and keeps what it heard', () => {
		t = trace();
		const a = visit.create();
		a.go('loading');
		t.stop();
		a.go('answered');
		expect(t.lines()).toEqual(['visit#1 idle -> loading']);
	});

	it('stops at the end of a `using` block', () => {
		const a = visit.create();
		let seen: string[];
		{
			using moves = trace();
			a.go('loading');
			seen = moves.lines();
			t = moves;
		}
		a.go('answered');
		expect(t.lines()).toEqual(seen);
	});

	it('forgets its lines on clear(), and keeps numbering', () => {
		t = trace();
		const a = visit.create();
		a.go('loading');
		t.clear();
		visit.create().go('loading');
		expect(t.text()).toBe('visit#2 idle -> loading');
	});
});
