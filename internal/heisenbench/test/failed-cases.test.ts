// A BENCH CASE THAT THROWS FAILS THE GATE (#1869): Heisenbench prints FAILED for it and writes its
// error into the report, but the gate read only which functions ran, so a case that threw for weeks
// left its code unmeasured and nothing went red. The gate lists every case that threw and fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failed_cases, failed_cases_md } from '../src/failed-cases.ts';

const report = (cases: { name: string; file: string; error?: string }[]) => ({ cases });

test('a case with an error in its report is a failed case; the others are not', () => {
	const failed = failed_cases([
		report([
			{ name: 'ok', file: 'packages/a/bench/a.bench.ts' },
			{ name: 'threw', file: 'packages/a/bench/a.bench.ts', error: 'boom' }
		]),
		report([{ name: 'also', file: 'packages/b/bench/b.bench.ts', error: 'down' }])
	]);
	assert.deepEqual(failed, [
		{ name: 'threw', file: 'packages/a/bench/a.bench.ts', error: 'boom' },
		{ name: 'also', file: 'packages/b/bench/b.bench.ts', error: 'down' }
	]);
});

test('no failed case writes nothing to the gate', () => {
	assert.equal(failed_cases_md([]), '');
	assert.deepEqual(failed_cases([report([{ name: 'ok', file: 'f' }]), {}]), []);
});

test("the gate's text names each failed case, its file and its error's first line", () => {
	const md = failed_cases_md([{ name: 'threw', file: 'f.bench.ts', error: 'boom\n  at x' }]);
	assert.match(md, /1 bench case threw/);
	assert.match(md, /`f\.bench\.ts` › threw: boom$/m);
	assert.doesNotMatch(md, /at x/);
});
