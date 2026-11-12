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
});
