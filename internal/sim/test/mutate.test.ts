// Mutation testing through the simulator (src/mutate.ts): a mutant is one change at one line of a
// package's source; it is killed when a seed finds what that seed did not find on the code as it is.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	apply_mutant,
	baseline_packages,
	clone_command,
	confirmed,
	package_of,
	runnable,
	seed_list,
	tally,
	targets,
	verdict,
	type Mutant
} from '../src/mutate.ts';

const SRC = `function f(a, b) {
\tif (a === b && a > 0) return true;
\treturn false;
}`;

describe('a mutant', () => {
	it('changes the first match on its line, and only there', () => {
		const m = {
			file: 'packages/core/src/x.ts',
			line: 2,
			operator: 'equality',
			from: '===',
			to: '!=='
		};
		expect(apply_mutant(SRC, m).split('\n')[1]).toBe('\tif (a !== b && a > 0) return true;');
		expect(
			apply_mutant(SRC, m)
				.split('\n')
				.filter((l, i) => l !== SRC.split('\n')[i])
		).toHaveLength(1);
	});

	it('spells its change by operator when it names no text', () => {
		const at = (operator: string, line: number) =>
			apply_mutant(SRC, { file: 'packages/core/src/x.ts', line, operator }).split('\n')[line - 1];
		expect(at('logical', 2)).toBe('\tif (a === b || a > 0) return true;');
		expect(at('relational', 2)).toBe('\tif (a === b && a >= 0) return true;');
		expect(at('boolean', 2)).toBe('\tif (a === b && a > 0) return false;');
		expect(at('boolean', 3)).toBe('\treturn true;');
	});

	it('refuses one that does not apply (its text is not on its line), rather than change nothing', () => {
		expect(() =>
			apply_mutant(SRC, {
				file: 'packages/core/src/x.ts',
				line: 3,
				operator: 'x',
				from: '===',
				to: '!=='
			})
		).toThrow(/line 3/);
		expect(() =>
			apply_mutant(SRC, { file: 'packages/core/src/x.ts', line: 9, operator: 'boolean' })
		).toThrow(/line 9/);
	});

	it('names the package it builds', () => {
		expect(package_of('packages/core/src/runtime/core.ts')).toBe('packages/core');
		expect(() => package_of('internal/sim/src/cli.ts')).toThrow(/package/);
	});

	it('finds its line by its code when the source moved, the nearest of several', () => {
		// (the daily list's lines went stale as main moved: both mutants changed a comment line or
		// threw, and the job judged nothing)
		const moved = ['// a', '// b', SRC, '\treturn false;'].join('\n');
		const m = {
			file: 'packages/core/src/x.ts',
			line: 3,
			code: 'return false;',
			operator: 'boolean'
		};
		const out = apply_mutant(moved, m).split('\n');
		expect(out[4]).toBe('\treturn true;');
		expect(out[6]).toBe('\treturn false;');
		expect(() => apply_mutant(moved, { ...m, code: 'return maybe;' })).toThrow(/return maybe/);
	});

	it('of the daily list applies to the code as it is', () => {
		const root = fileURLToPath(new URL('../../../', import.meta.url));
		const list = JSON.parse(
			readFileSync(new URL('../mutants.json', import.meta.url), 'utf8')
		) as Mutant[];
		for (const m of list) {
			expect(m.code, `${m.id} names its line's code`).toBeTypeOf('string');
			expect(() => apply_mutant(readFileSync(root + m.file, 'utf8'), m)).not.toThrow();
		}
	});
});

describe('the verdict', () => {
	const base = new Map([
		['191:3', ['waste 1a']],
		['191:4', []]
	]);
	it('is killed by a finding a seed did not have on the code as it is', () => {
		expect(
			verdict(
				base,
				new Map([
					['191:3', ['waste 1a']],
					['191:4', ['stuck 2b']]
				])
			)
		).toEqual({
			killed: true,
			by: ['191:4 stuck 2b']
		});
	});

	it('survives when every seed finds what it found before (or less)', () => {
		expect(
			verdict(
				base,
				new Map([
					['191:3', []],
					['191:4', []]
				])
			)
		).toEqual({ killed: false, by: [] });
	});

	it('is killed by a build that fails, or a seed that did not finish', () => {
		expect(verdict(base, new Map([['191:3', ['waste 1a']]]), 'build failed').killed).toBe(true);
		expect(verdict(base, new Map([['191:3', ['waste 1a']]])).by).toEqual(['191:4 did not finish']);
	});
});

describe('a mutation run', () => {
	it('clones the repo copy-on-write on macOS and on Linux (the daily job runs on Linux)', () => {
		expect(clone_command('darwin', '/r', '/b')).toBe("cp -cR '/r' '/b'");
		expect(clone_command('linux', '/r', '/b')).toBe("cp -a --reflink=auto '/r' '/b'");
	});

	it('stops starting mutants past its time budget, and says how many it got through', () => {
		expect(tally([{ killed: true }, { killed: false }], 5, '2026-11-12T10:00:00.000Z')).toEqual({
			killed: 1,
			judged: 2,
			equivalent: 0,
			total: 5,
			rate: 50,
			at: '2026-11-12T10:00:00.000Z'
		});
		expect(tally([], 5, 'x').rate).toBe(0);
	});

	it('keeps a kill only when a second run of its seed finds the same again (gen 734, seed 12: a chunk 404 three mutants "died" by, that no second run found)', () => {
		const again = (found: Record<string, string[]>) => (target: string, seed: number) =>
			found[`${target}:${seed}`] ?? [];
		const by = ['gen734:12 page-errors aaa', 'gen734:3 stuck bbb'];
		expect(confirmed(by, again({}))).toEqual([]);
		expect(confirmed(by, again({ 'gen734:3': ['stuck bbb'] }))).toEqual(['gen734:3 stuck bbb']);
		// (a build that failed is no seed's finding: it stands)
		expect(confirmed(['the package build failed'], again({}))).toEqual([
			'the package build failed'
		]);
	});

	it('sets apart a mutant written up as equivalent: never run, said with its reason, out of the rate', () => {
		const m = (equivalent?: string): Mutant => ({
			file: 'packages/core/src/runtime/schedule.ts',
			line: 1,
			operator: 'boolean',
			...(equivalent ? { equivalent } : {})
		});
		const { run, equivalent } = runnable([m(), m('no run can tell'), m()]);
		expect(run).toHaveLength(2);
		expect(equivalent.map((e) => e.equivalent)).toEqual(['no run can tell']);
		expect(tally([{ killed: true }, { killed: false }], 3, 'x', 1)).toMatchObject({
			killed: 1,
			judged: 2,
			equivalent: 1,
			rate: 50
		});
	});

	it("runs a target's own seeds past the run's range (gen 550 kills schedule.ts:415 only on seeds 33, 36, 65 and 74)", () => {
		expect(targets('188,550+33+36+65+74', false)).toEqual([
			{ name: 'gen188', gen: 188, extra: [] },
			{ name: 'gen550', gen: 550, extra: [33, 36, 65, 74] }
		]);
		expect(targets('', true)).toEqual([{ name: 'palaestra', gen: null, extra: [] }]);
		expect(seed_list(20, [33, 5, 36])).toEqual([
			...Array.from({ length: 20 }, (_, i) => i + 1),
			33,
			36
		]);
	});

	it("builds, before its baseline, every package a mutant's build would (a clone's stale dependents killed every mutant alike)", () => {
		const m = (file: string): Mutant => ({ file, line: 1, operator: 'statement' });
		expect(
			baseline_packages([
				m('packages/core/src/runtime/core.ts'),
				m('packages/core/src/runtime/schedule.ts'),
				m('packages/federation/src/peer.ts')
			])
		).toEqual(['packages/core', 'packages/federation']);
	});
});
