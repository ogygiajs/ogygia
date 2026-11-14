// A decision table's hot paths: decide() as a region render asks it (a page of regions, each
// deciding its plan once), and rows() as a test walks the whole table.
import { bench } from '@bench/heisenbench/bench';
import { decisions } from '../src/index.ts';
import { check, count, dead_fields, rows, table } from '../src/testing.ts';

const TRIGGERS = ['load', 'visible', 'idle', 'interaction', 'media', 'never'] as const;

const plan = decisions({
	name: 'region-plan',
	inputs: {
		trigger: TRIGGERS,
		held: [false, true],
		js: ['none', 'some'],
		streamed: [false, true],
		nested: [false, true]
	} as const,
	refuse: (i) => (i.held && i.trigger === 'load' ? 'a held region never wakes on load' : null),
	decide: (i) => ({
		now: i.js === 'some' && i.trigger === 'load',
		head: { runtime: i.js === 'some', observe: i.js === 'some' && i.trigger === 'visible' },
		placeholder: i.streamed || i.held,
		parent: i.nested ? 'region' : 'page',
		listens: i.trigger === 'interaction' ? ['pointerdown', 'focusin'] : []
	})
});

type Input = Parameters<typeof plan.decide>[0];

function page(n: number): Input[] {
	const out: Input[] = [];
	for (let k = 0; k < n; k++) {
		const trigger = TRIGGERS[k % TRIGGERS.length];
		out.push({
			trigger,
			held: trigger !== 'load' && k % 5 === 0,
			js: k % 3 === 0 ? 'none' : 'some',
			streamed: k % 4 === 0,
			nested: k % 7 === 0
		});
	}
	return out;
}

bench(
	'decisions: 200 regions on a page each decide their plan',
	({ inputs }) => {
		let now = 0;
		for (const i of inputs) if (plan.decide(i).now) now++;
		return now;
	},
	{ setup: () => ({ inputs: page(200) }), scale: (_ctx, k) => ({ inputs: page(200 * k) }) }
);

bench('decisions: rows() walks the whole 96-row table', () => {
	let refused = 0;
	for (const row of rows(plan)) if ('refused' in row) refused++;
	return refused;
});

bench('decisions: a table made, and an input it refuses', () => {
	const made = decisions({ ...plan.def, name: 'again' });
	try {
		made.decide({ trigger: 'load', held: true, js: 'none', streamed: false, nested: false });
	} catch (error) {
		return error instanceof Error ? error.message.length : 0;
	}
	return 0;
});

bench('decisions: check() runs three rules over every row', () =>
	check(plan, {
		'a held row is refused or shows a placeholder': (r) =>
			!r.input.held || 'refused' in r || r.plan.placeholder,
		'nothing wakes now without js': (r) => !('plan' in r) || !r.plan.now || r.input.js === 'some',
		'a nested row has a region parent': (r) =>
			!('plan' in r) || r.input.nested === (r.plan.parent === 'region')
	}));

bench('decisions: check() names a broken rule', () => {
	try {
		check(plan, { 'never observes': (r) => !('plan' in r) || !r.plan.head.observe });
	} catch (error) {
		return error instanceof Error ? error.message.length : 0;
	}
	return 0;
});

bench('decisions: table() writes the whole table', () => table(plan).length + count(plan));

const UNREAD = decisions({
	name: 'unread',
	inputs: { kind: ['a', 'b', 'c'], debug: [false, true] } as const,
	decide: (i) => ({ order: [i.kind, 'tail'], debug: null })
});

bench('decisions: dead_fields() over the whole table, a sample, and a table with an unread field', () =>
	dead_fields(plan).length +
	dead_fields(plan, { sample: { seed: 3, size: 10 } }).length +
	dead_fields(UNREAD).length);

bench('decisions: rows() walks a seeded sample of 40 rows', () => {
	let n = 0;
	for (const row of rows(plan, { sample: { seed: 7, size: 40 } })) if (row.input.held) n++;
	return n;
});
