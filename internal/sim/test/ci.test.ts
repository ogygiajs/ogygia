// The always-on runner (src/ci.ts): a batch that did not run is never counted, a found branch never
// needs a forced push, and no error it reports carries the token.
import { describe, expect, it } from 'vitest';
import {
	batch_result,
	free_branch,
	quality_line,
	redact,
	signature,
	unreached_in_every
} from '../src/ci.ts';

const OUT = JSON.stringify({ findings: [], steps_per_second: 10, replay_leaks: [] });

describe('a batch', () => {
	it('that found nothing or something is read', () => {
		expect(batch_result(0, null, () => OUT)).toEqual(JSON.parse(OUT));
		expect(batch_result(1, null, () => OUT)).toEqual(JSON.parse(OUT));
	});

	it('that crashed, hung or had no build fails, whatever file is there', () => {
		for (const status of [2, 3, 134])
			expect(batch_result(status, null, () => OUT)).toEqual({
				failed: `the simulator ended with exit code ${status}`
			});
		expect(batch_result(null, 'SIGKILL', () => OUT)).toEqual({
			failed: 'the simulator ended with SIGKILL'
		});
	});

	it('that wrote no results fails', () => {
		expect(batch_result(0, null, () => null)).toEqual({ failed: 'the simulator wrote no results' });
	});
});

describe('a found branch', () => {
	it('is new even when its signature was filed before', () => {
		expect(free_branch('abc', new Set())).toBe('sim/found-abc');
		expect(free_branch('abc', new Set(['sim/found-abc']))).toBe('sim/found-abc-2');
		expect(free_branch('abc', new Set(['sim/found-abc', 'sim/found-abc-2']))).toBe(
			'sim/found-abc-3'
		);
	});
});

describe("a finding's signature", () => {
	// (a mutant is a rebuilt app: every file name and position in a stack moves, and each mutant's
	// baseline failure read as a new finding, a kill: gen 192, seed 11's five)
	it('is the same for an uncaught error whose stack points into another build', () => {
		const at = (file: string, line: number, column: number) => ({
			oracle: 'uncaught',
			detail: `after tab 0: click link #3: TypeError: c.navigate is not a function
    at Object.navigate (https://app.test/_app/immutable/${file}:${line}:${column})
    at https://app.test/_app/immutable/${file}:${line}:${column + 40}`
		});
		const base = signature(at('og-runtime-9038e5f3.BbtuYXh-.js', 6, 52784));
		expect(signature(at('og-runtime-9038e5f3.B4tu7Xh-.js', 6, 52784))).toBe(base);
		expect(signature(at('og-runtime-1a2b3c4d.CC3_pZej.js', 7, 1203))).toBe(base);
		// (what the error says, and where in the code, still tell findings apart)
		expect(
			signature({ ...at('og-runtime-9038e5f3.BbtuYXh-.js', 6, 52784), oracle: 'page-errors' })
		).not.toBe(base);
		expect(
			signature({
				oracle: 'uncaught',
				detail: at('og-runtime-9038e5f3.BbtuYXh-.js', 6, 52784).detail.replace(
					'Object.navigate',
					'Object.goto'
				)
			})
		).not.toBe(base);
	});
});

describe('an error', () => {
	it('never carries a secret', () => {
		const said = redact('push https://x-access-token:s3cr3t@github.com failed (czNjcjN0)', [
			's3cr3t',
			'czNjcjN0',
			undefined
		]);
		expect(said).toBe('push https://x-access-token:***@github.com failed (***)');
	});
});

describe('recovery steps no batch reached', () => {
	it('are the ones every batch missed (a step one batch reached is reached)', () => {
		expect(
			unreached_in_every([
				['hole: offline -> idle', 'hole: retrying -> fetching'],
				['hole: retrying -> fetching', 'wake: offline -> cold']
			])
		).toEqual(['hole: retrying -> fetching']);
		expect(unreached_in_every([])).toEqual([]);
	});
});

describe('the quality line', () => {
	it('says the steps accounted for and the latest mutation run, with its date and how far it got', () => {
		expect(
			quality_line(
				{ accounted: 220, total: 228 },
				{ killed: 3, judged: 4, total: 10, rate: 75, at: '2026-11-12T03:50:00.000Z' }
			)
		).toBe(
			'steps accounted: 220/228 (96.5%); mutation kill rate: 75% (3/4 judged of 10, 2026-11-12)'
		);
		expect(quality_line(null, null)).toBe(
			'steps accounted: no sweep this run; mutation kill rate: no finished run yet'
		);
	});
});
