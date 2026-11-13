// Every machine step accounted for (src/steps.ts): reached by the standard sweep, dead (filed for
// removal), or covered by a named real test the check finds. A step in no bucket fails, so a new
// step nobody reaches or tests fails the build.
import { describe, expect, it } from 'vitest';
import { account, type Ledger } from '../src/steps.ts';

const ALL = new Set(['m: a -> b', 'm: b -> c', 'm: c -> a', 'n: x -> y']);

const ledger = (over: Partial<Ledger> = {}): Ledger => ({
	sweep: { palaestra: { runs: 10, steps: 30 }, gens: [], runs: 10, steps: 30 },
	reached: ['m: a -> b', 'm: b -> c'],
	covered: [
		{
			step: 'm: c -> a',
			reason: 'a real browser only',
			test: 'packages/core/test/browser/m.test.ts',
			name: 'goes back to a'
		}
	],
	dead: [{ step: 'n: x -> y', issue: 1, why: 'no code moves there' }],
	...over
});

const files: Record<string, string> = {
	'packages/core/test/browser/m.test.ts': "it('goes back to a', () => {});"
};
const read = (p: string): string | null => files[p] ?? null;

describe('steps accounted', () => {
	it('passes a ledger with every step in exactly one bucket', () => {
		const a = account(ALL, ledger(), { read });
		expect(a.failures).toEqual([]);
		expect([a.accounted, a.total]).toEqual([4, 4]);
	});

	it('fails a step in no bucket (a new step nothing reaches or tests)', () => {
		const a = account(new Set([...ALL, 'm: a -> c']), ledger(), { read });
		expect(a.failures).toEqual(['in no bucket: m: a -> c']);
		expect([a.accounted, a.total]).toEqual([4, 5]);
	});

	it('fails a step in two buckets, and a bucket naming a step no machine has', () => {
		const a = account(
			ALL,
			ledger({ reached: ['m: a -> b', 'm: b -> c', 'n: x -> y', 'gone: p -> q'] }),
			{
				read
			}
		);
		expect(a.failures).toEqual([
			'in two buckets: n: x -> y (reached, dead)',
			'no machine has it (the ledger names it): gone: p -> q'
		]);
	});

	it('fails a covered step whose test file or test is not there', () => {
		const none = account(ALL, ledger(), { read: () => null });
		expect(none.failures).toEqual([
			'm: c -> a: its test file is not there: packages/core/test/browser/m.test.ts'
		]);
		const renamed = account(ALL, ledger(), { read: () => "it('goes to a', () => {});" });
		expect(renamed.failures).toEqual([
			"m: c -> a: packages/core/test/browser/m.test.ts has no test 'goes back to a'"
		]);
	});

	it('against a sweep: fails a reached step it no longer reaches, and a dead step it reached', () => {
		const a = account(ALL, ledger(), {
			read,
			sweep: new Set(['m: a -> b', 'n: x -> y', 'm: c -> a'])
		});
		expect(a.failures).toEqual([
			'the sweep no longer reaches it: m: b -> c',
			'listed dead, but the sweep reached it: n: x -> y'
		]);
		// (a covered step the sweep now reaches is said, to move it, and is no failure)
		expect(a.newly_reached).toEqual(['m: c -> a']);
		// (accounted against the sweep: what it reached, and the covered and dead buckets)
		expect([a.accounted, a.total]).toEqual([3, 4]);
	});

	// (a step one lucky seed reached is not covered: the sweep replays a saved plan that reaches it,
	// the same run every time, and names the steps it must reach)
	const planned = ledger({
		sweep: {
			...ledger().sweep,
			plans: [{ app: 192, plan: 'internal/sim/sweep-plans/b-c.json', reaches: ['m: b -> c'] }]
		}
	});
	const with_plan = (p: string): string | null =>
		p === 'internal/sim/sweep-plans/b-c.json' ? '{}' : read(p);

	it('fails a plan whose file is not there, or whose step is not in the reached bucket', () => {
		expect(account(ALL, planned, { read: with_plan }).failures).toEqual([]);
		expect(account(ALL, planned, { read }).failures).toEqual([
			'its plan is not there: internal/sim/sweep-plans/b-c.json'
		]);
		const stray = ledger({
			sweep: {
				...ledger().sweep,
				plans: [{ app: 192, plan: 'internal/sim/sweep-plans/b-c.json', reaches: ['m: c -> a'] }]
			}
		});
		expect(account(ALL, stray, { read: with_plan }).failures).toEqual([
			'internal/sim/sweep-plans/b-c.json reaches m: c -> a, which is not in the reached bucket'
		]);
	});

	it('against a sweep: fails a plan that no longer reaches its step, though seeds did', () => {
		const sweep = new Set(['m: a -> b', 'm: b -> c']);
		const kept = account(ALL, planned, {
			read: with_plan,
			sweep,
			plans: new Map([['internal/sim/sweep-plans/b-c.json', new Set(['m: b -> c'])]])
		});
		expect(kept.failures).toEqual([]);
		const lost = account(ALL, planned, {
			read: with_plan,
			sweep,
			plans: new Map([['internal/sim/sweep-plans/b-c.json', new Set(['m: a -> b'])]])
		});
		// (it says which plan, which step, what its run took of that machine instead, and why)
		expect(lost.failures).toEqual([
			'its plan no longer reaches it: m: b -> c (internal/sim/sweep-plans/b-c.json). Of m its run took m: a -> b. Every action found what it named: the app or its timing moved, so find a new run for it'
		]);
		const gone = account(ALL, planned, {
			read: with_plan,
			sweep,
			plans: new Map([['internal/sim/sweep-plans/b-c.json', new Set<string>()]]),
			missed: new Map([
				[
					'internal/sim/sweep-plans/b-c.json',
					['action 2 (tab 0: click link #4): link /b is not on the page (picked link /a)']
				]
			])
		});
		expect(gone.failures).toEqual([
			'its plan no longer reaches it: m: b -> c (internal/sim/sweep-plans/b-c.json). Its run took no step of m. What it named is gone: action 2 (tab 0: click link #4): link /b is not on the page (picked link /a)'
		]);
	});
});
