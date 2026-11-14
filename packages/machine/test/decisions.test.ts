import fc from 'fast-check';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { decisions, MachineError, type Decisions } from '../src/index.ts';
import { check, count, dead_fields, rows, table, type Row } from '../src/testing.ts';

const wake = decisions({
	name: 'wake',
	inputs: {
		trigger: ['load', 'visible', 'idle'],
		held: [false, true],
		js: ['none', 'some']
	} as const,
	refuse: (i) => (i.held && i.trigger === 'load' ? 'a held region never wakes on load' : null),
	decide: (i) => ({
		now: i.js === 'some' && i.trigger === 'load',
		head: { runtime: i.js === 'some', observe: i.js === 'some' && i.trigger === 'visible' }
	})
});

function code_of(f: () => unknown): string {
	try {
		f();
	} catch (error) {
		if (error instanceof MachineError) return error.code;
		throw error;
	}
	throw new Error('it did not throw');
}

describe('decisions(): decide', () => {
	it('gives the plan decide makes for an input', () => {
		expect(wake.decide({ trigger: 'visible', held: false, js: 'some' })).toEqual({
			now: false,
			head: { runtime: true, observe: true }
		});
	});

	it('a refused input throws its code, naming the input and the reason', () => {
		expect(code_of(() => wake.decide({ trigger: 'load', held: true, js: 'none' }))).toBe(
			'machine_decision_refused'
		);
		expect(() => wake.decide({ trigger: 'load', held: true, js: 'none' })).toThrow(
			'decisions wake: no app can ask for { trigger: "load", held: true, js: "none" }: a held region never wakes on load.'
		);
	});

	it('a table with no refuse decides every input', () => {
		const d = decisions({ name: 'any', inputs: { a: [1, 2] } as const, decide: (i) => i.a * 2 });
		expect(d.decide({ a: 2 })).toBe(4);
	});

	it('in dev, a value outside its field list throws, naming the field', () => {
		const untyped = wake as unknown as Decisions<Record<string, unknown>, unknown>;
		expect(code_of(() => untyped.decide({ trigger: 'hover', held: false, js: 'none' }))).toBe(
			'machine_decision_outside'
		);
		expect(() => untyped.decide({ trigger: 'idle', held: false })).toThrow(
			'decisions wake: `js` is undefined, which is not one of the values its `inputs` lists.'
		);
	});

	it('the field check runs before refuse and decide see the input', () => {
		const seen = vi.fn(() => null);
		const d = decisions({ name: 'd', inputs: { a: ['x'] } as const, refuse: seen, decide: seen });
		const untyped = d as unknown as Decisions<{ a: string }, unknown>;
		expect(() => untyped.decide({ a: 'y' })).toThrow(MachineError);
		expect(seen).not.toHaveBeenCalled();
	});

	it('in dev, an empty or repeated field list is refused where the table is made', () => {
		expect(code_of(() => decisions({ name: 'e', inputs: { a: [] }, decide: () => 0 }))).toBe(
			'machine_bad_option'
		);
		expect(() => decisions({ name: 'e', inputs: { a: ['x', 'x'] }, decide: () => 0 })).toThrow(
			'`decisions e inputs.a` must be a list with each value once (got ["x", "x"])'
		);
	});

	it('keeps the definition as given', () => {
		expect(wake.def.name).toBe('wake');
		expect(wake.def.inputs.trigger).toEqual(['load', 'visible', 'idle']);
	});
});

describe('decisions(): types', () => {
	it('infers the input from the field lists, and the plan from decide', () => {
		type Input = Parameters<typeof wake.decide>[0];
		expectTypeOf<Input>().toEqualTypeOf<{
			readonly trigger: 'load' | 'visible' | 'idle';
			readonly held: false | true;
			readonly js: 'none' | 'some';
		}>();
		expectTypeOf<ReturnType<typeof wake.decide>>().toEqualTypeOf<{
			now: boolean;
			head: { runtime: boolean; observe: boolean };
		}>();
		// @ts-expect-error -- a value outside its list does not compile
		expect(() => wake.decide({ trigger: 'hover', held: false, js: 'none' })).toThrow();
	});
});

describe('testing: count and rows', () => {
	it('count is the product of the list lengths', () => {
		expect(count(wake)).toBe(12);
	});

	it('rows walks every combination in order, the last field fastest, refused ones named', () => {
		const all = [...rows(wake)];
		expect(all).toHaveLength(12);
		expect(all.map((r) => r.input)).toEqual([
			{ trigger: 'load', held: false, js: 'none' },
			{ trigger: 'load', held: false, js: 'some' },
			{ trigger: 'load', held: true, js: 'none' },
			{ trigger: 'load', held: true, js: 'some' },
			{ trigger: 'visible', held: false, js: 'none' },
			{ trigger: 'visible', held: false, js: 'some' },
			{ trigger: 'visible', held: true, js: 'none' },
			{ trigger: 'visible', held: true, js: 'some' },
			{ trigger: 'idle', held: false, js: 'none' },
			{ trigger: 'idle', held: false, js: 'some' },
			{ trigger: 'idle', held: true, js: 'none' },
			{ trigger: 'idle', held: true, js: 'some' }
		]);
		expect(all[2]).toEqual({
			input: { trigger: 'load', held: true, js: 'none' },
			refused: 'a held region never wakes on load'
		});
		expect(all[1]).toEqual({
			input: { trigger: 'load', held: false, js: 'some' },
			plan: { now: true, head: { runtime: true, observe: false } }
		});
	});

	it('rows is lazy: it decides one row per step', () => {
		const decide = vi.fn((i: { a: number }) => i.a);
		const d = decisions({ name: 'lazy', inputs: { a: [1, 2, 3] } as const, decide });
		const it = rows(d);
		expect(decide).not.toHaveBeenCalled();
		it.next();
		expect(decide).toHaveBeenCalledOnce();
	});

	it('a table with no fields has one row, the empty input', () => {
		const d = decisions({ name: 'none', inputs: {}, decide: () => 'only' });
		expect(count(d)).toBe(1);
		expect([...rows(d)]).toEqual([{ input: {}, plan: 'only' }]);
	});

	it('every row is a combination of the lists, each once, as many as count (property)', () => {
		fc.assert(
			fc.property(
				fc.array(fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { minLength: 1, maxLength: 4 }), {
					maxLength: 4
				}),
				(lists) => {
					const inputs = Object.fromEntries(lists.map((list, f) => [`f${f}`, list]));
					const d = decisions({ name: 'p', inputs, decide: (i) => i });
					const all = [...rows(d)];
					expect(all).toHaveLength(count(d));
					expect(count(d)).toBe(lists.reduce((n, list) => n * list.length, 1));
					const keys = new Set(all.map((r) => JSON.stringify(r.input)));
					expect(keys.size).toBe(all.length);
					for (const r of all) {
						expect(Object.keys(r.input)).toEqual(Object.keys(inputs));
						for (const field in inputs) expect(inputs[field]).toContain(r.input[field]);
						expect('plan' in r && r.plan).toEqual(r.input);
					}
				}
			)
		);
	});

	it('a sample is that many distinct rows, the same for the same seed (property)', () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 4 }),
				fc.integer(),
				fc.integer({ min: 1, max: 40 }),
				(sizes, seed, size) => {
					const inputs = Object.fromEntries(
						sizes.map((n, f) => [`f${f}`, Array.from({ length: n }, (_, v) => v)])
					);
					const d = decisions({ name: 's', inputs, decide: () => 0 });
					const once = [...rows(d, { sample: { seed, size } })].map((r) => JSON.stringify(r.input));
					const again = [...rows(d, { sample: { seed, size } })].map((r) =>
						JSON.stringify(r.input)
					);
					expect(again).toEqual(once);
					expect(new Set(once).size).toBe(once.length);
					expect(once.length).toBe(Math.min(size, count(d)));
					const every = new Set([...rows(d)].map((r) => JSON.stringify(r.input)));
					for (const key of once) expect(every.has(key)).toBe(true);
				}
			)
		);
	});

	it('another seed picks other rows', () => {
		const inputs = { a: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], b: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
		const d = decisions({ name: 's', inputs, decide: () => 0 });
		const pick = (seed: number) =>
			[...rows(d, { sample: { seed, size: 5 } })].map((r) => JSON.stringify(r.input));
		expect(pick(1)).not.toEqual(pick(2));
	});
});

describe('testing: the huge-space guard', () => {
	const ten = Array.from({ length: 10 }, (_, v) => v);
	const huge = decisions({
		name: 'huge',
		inputs: { a: ten, b: ten, c: ten, d: ten, e: ten, f: ten },
		decide: () => 0
	});

	it('refuses past 100,000 rows at once, naming the count and how to sample', () => {
		expect(count(huge)).toBe(1_000_000);
		expect(code_of(() => rows(huge))).toBe('machine_decisions_too_many');
		expect(() => rows(huge)).toThrow(
			'decisions huge: its inputs make 1000000 combinations, more than the 100000 a listing walks.'
		);
		expect(() => table(huge)).toThrow(MachineError);
		expect(() => check(huge, {})).toThrow(MachineError);
		expect(() => dead_fields(huge)).toThrow(MachineError);
	});

	it('a higher max walks it; a sample walks a seeded few', () => {
		expect(code_of(() => rows(decisions({ ...huge.def }), { max: 10 }))).toBe(
			'machine_decisions_too_many'
		);
		expect([...rows(huge, { sample: { seed: 7, size: 50 } })]).toHaveLength(50);
		expect(code_of(() => rows(huge, { sample: { seed: 7, size: 200_000 } }))).toBe(
			'machine_decisions_too_many'
		);
	});

	it('samples a space past the largest exact index (2^53) all the same: distinct rows', () => {
		const inputs = Object.fromEntries(Array.from({ length: 17 }, (_, f) => [`f${f}`, ten]));
		const vast = decisions({ name: 'vast', inputs, decide: () => 0 });
		expect(count(vast)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
		const picked = [...rows(vast, { sample: { seed: 1, size: 20 } })];
		expect(new Set(picked.map((r) => JSON.stringify(r.input))).size).toBe(20);
	});

	it('refuses a sample that is not whole numbers, and a max under 1', () => {
		expect(code_of(() => rows(huge, { sample: { seed: 0.5, size: 1 } }))).toBe(
			'machine_bad_option'
		);
		expect(code_of(() => rows(huge, { sample: { seed: 1, size: 0 } }))).toBe('machine_bad_option');
		expect(code_of(() => rows(wake, { max: 0 }))).toBe('machine_bad_option');
	});
});

describe('testing: check', () => {
	it('returns how many rows it checked when every rule holds', () => {
		expect(
			check(wake, {
				'a refused row is held': (r) => !('refused' in r) || r.input.held,
				'nothing wakes now without js': (r) =>
					!('plan' in r) || !r.plan.now || r.input.js === 'some'
			})
		).toBe(12);
	});

	it('throws naming each broken rule with the first row that breaks it', () => {
		let thrown: unknown;
		try {
			check(wake, {
				'holds everywhere': () => true,
				'never observes': (r) => !('plan' in r) || !r.plan.head.observe,
				'no refusals': (r) => !('refused' in r)
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(MachineError);
		const error = thrown as MachineError;
		expect(error.code).toBe('machine_decisions_rule_broken');
		expect(error.message).toContain(`decisions wake: some rules do not hold:
- no refusals: { trigger: "load", held: true, js: "none" } -> refused (a held region never wakes on load)
- never observes: { trigger: "visible", held: false, js: "some" } -> { now: false, head: { runtime: true, observe: true } }`);
		expect(error.message).not.toContain('holds everywhere');
	});

	it('a rule that throws breaks, with what it threw', () => {
		expect(() =>
			check(wake, {
				boom: (r) => {
					if (r.input.trigger === 'idle') throw new Error('no idle here');
					return true;
				}
			})
		).toThrow(
			'- boom: { trigger: "idle", held: false, js: "none" } -> { now: false, head: { runtime: false, observe: false } } (the rule threw: no idle here)'
		);
	});

	it('a rule that returns something other than true breaks', () => {
		const loose = { truthy: () => 1 } as unknown as Record<
			string,
			(r: Row<unknown, unknown>) => boolean
		>;
		expect(() => check(wake, loose)).toThrow('- truthy:');
	});
});

describe('testing: table', () => {
	it('one row per input, fields as columns, the plan flattened, refused last', () => {
		expect(table(wake))
			.toBe(`| trigger | held  | js   | now   | head.runtime | head.observe | refused                           |
| ------- | ----- | ---- | ----- | ------------ | ------------ | --------------------------------- |
| load    | false | none | false | false        | false        |                                   |
| load    | false | some | true  | true         | false        |                                   |
| load    | true  | none |       |              |              | a held region never wakes on load |
| load    | true  | some |       |              |              | a held region never wakes on load |
| visible | false | none | false | false        | false        |                                   |
| visible | false | some | false | true         | true         |                                   |
| visible | true  | none | false | false        | false        |                                   |
| visible | true  | some | false | true         | true         |                                   |
| idle    | false | none | false | false        | false        |                                   |
| idle    | false | some | false | true         | false        |                                   |
| idle    | true  | none | false | false        | false        |                                   |
| idle    | true  | some | false | true         | false        |                                   |`);
	});

	it('a plan that is not an object is one plan column; pipes and line breaks are escaped', () => {
		const d = decisions({
			name: 'raw',
			inputs: { a: ['x|y', 'z'] } as const,
			decide: (i) => (i.a === 'z' ? 'two\nlines' : ['a', 1])
		});
		expect(table(d)).toBe(String.raw`| a    | plan      |
| ---- | --------- |
| x\|y | ["a", 1]  |
| z    | two lines |`);
	});
});

describe('testing: dead_fields', () => {
	it('names the fields that never change the outcome', () => {
		const d = decisions({
			name: 'dead',
			inputs: { a: [1, 2], b: ['x', 'y'], c: [true, false], only: ['one'] } as const,
			decide: (i) => ({ a: i.a, flag: i.c || i.a === 1 })
		});
		expect(dead_fields(d)).toEqual(['b', 'only']);
	});

	it('a field that only changes the refusal is not dead', () => {
		const d = decisions({
			name: 'r',
			inputs: { a: [1, 2], b: [1, 2] } as const,
			refuse: (i) => (i.b === 2 ? 'no b 2' : null),
			decide: () => 0
		});
		expect(dead_fields(d)).toEqual(['a']);
		expect(dead_fields(wake)).toEqual([]);
	});

	it('equal plans that are new objects count as the same', () => {
		const d = decisions({
			name: 'eq',
			inputs: { a: [1, 2] } as const,
			decide: () => ({ list: [1, { x: null }], nested: { y: 'z' } })
		});
		expect(dead_fields(d)).toEqual(['a']);
	});

	it('the fields decide reads, with more than one value, are exactly the live ones (property)', () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({ size: fc.integer({ min: 1, max: 4 }), read: fc.boolean() }), {
					minLength: 1,
					maxLength: 5
				}),
				(fields) => {
					const inputs = Object.fromEntries(
						fields.map(({ size }, f) => [`f${f}`, Array.from({ length: size }, (_, v) => v)])
					);
					const read = fields.flatMap(({ read }, f) => (read ? [`f${f}`] : []));
					const d = decisions({
						name: 'p',
						inputs,
						decide: (i) => Object.fromEntries(read.map((field) => [field, i[field]]))
					});
					const dead = fields.flatMap(({ size, read }, f) => (read && size > 1 ? [] : [`f${f}`]));
					expect(dead_fields(d)).toEqual(dead);
					const sampled = dead_fields(d, { sample: { seed: 3, size: 4 } });
					for (const field of dead) expect(sampled).toContain(field);
				}
			)
		);
	});
});
