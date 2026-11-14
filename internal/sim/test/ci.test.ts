// The always-on runner (src/ci.ts): a batch that did not run is never counted, a found branch never
// needs a forced push, and no error it reports carries the token.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import {
	batch_result,
	FoundBranches,
	filing_error_line,
	free_branch,
	quality_line,
	redact,
	signature,
	unreached_in_every,
	waiting_runs
} from '../src/ci.ts';

const OUT = JSON.stringify({ findings: [], steps_per_second: 10, replay_leaks: [] });

describe('a batch', () => {
	it('that found nothing or something is read', () => {
		expect(batch_result(0, null, () => OUT)).toEqual({ ran: JSON.parse(OUT) });
		expect(batch_result(1, null, () => OUT)).toEqual({ ran: JSON.parse(OUT) });
	});

	it('that found something is read, its count of failed seeds no failure of the batch (run 43426260639: `failed: 5` read as a batch that did not run, and nothing was filed)', () => {
		const found = JSON.stringify({
			failed: 5,
			findings: [{ seed: 17, oracle: 'ssr-hydrate', detail: 'x' }],
			steps_per_second: 10,
			replay_leaks: [123]
		});
		expect(batch_result(1, null, () => found)).toEqual({ ran: JSON.parse(found) });
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
	const git = (cwd: string, ...a: string[]) =>
		execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], {
			cwd,
			stdio: 'pipe'
		})
			.toString()
			.trim();

	it('is the default branch at the push plus its test only, even when the default branch moved on during the run (run 43495274517: a branch from the simulated commit carried the default branch’s later workflow changes, and GitHub refused all five pushes)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'dst-ci-'));
		try {
			const remote = `file://${join(dir, 'remote.git')}`;
			git(dir, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
			git(dir, 'clone', '-q', remote, 'run');
			const run = join(dir, 'run');
			writeFileSync(join(run, 'a.txt'), 'a');
			git(run, 'add', 'a.txt');
			git(run, 'commit', '-q', '-m', 'simulated');
			git(run, 'push', '-q', 'origin', 'HEAD:main');
			const simulated = git(run, 'rev-parse', 'HEAD');
			git(dir, 'clone', '-q', remote, 'later');
			const later = join(dir, 'later');
			mkdirSync(join(later, '.github', 'workflows'), { recursive: true });
			writeFileSync(join(later, '.github', 'workflows', 'dst.yml'), 'on: push');
			git(later, 'add', '.');
			git(later, 'commit', '-q', '-m', 'a workflow changes on main');
			git(later, 'push', '-q', 'origin', 'HEAD:main');
			const tip = git(later, 'rev-parse', 'HEAD');

			const found = new FoundBranches(remote, run, undefined);
			const file = 'internal/sim/test/found/abc.test.ts';
			expect(found.push('abc', file, 'test source', 'test(sim): found abc')).toBe('sim/found-abc');
			expect(found.push('abc', file, 'test source', 'test(sim): found abc')).toBe(
				'sim/found-abc-2'
			);

			const bare = join(dir, 'remote.git');
			expect(git(bare, 'rev-parse', 'sim/found-abc^')).toBe(tip);
			expect(git(bare, 'diff', '--name-only', 'main', 'sim/found-abc')).toBe(file);
			expect(git(bare, 'show', `sim/found-abc:${file}`)).toBe('test source');
			expect(git(run, 'rev-parse', 'HEAD')).toBe(simulated);
			expect(git(run, 'status', '--porcelain')).toBe('');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('that could not be pushed is an error annotation naming the finding and the refusal', () => {
		const why = dedent`
			git push failed: Command failed: git push -q https://github.com/o/r.git x:refs/heads/x
			To https://github.com/o/r.git
			 ! [remote rejected] x -> x (refusing to allow a GitHub App to create or update workflow \`.github/workflows/dst.yml\` without \`workflows\` permission)
			error: failed to push some refs
		`;
		expect(filing_error_line('abc', why)).toBe(
			'::error title=DST could not file abc::! [remote rejected] x -> x (refusing to allow a GitHub App to create or update workflow `.github/workflows/dst.yml` without `workflows` permission)'
		);
		expect(filing_error_line('abc', 'gh failed: 100% broken')).toBe(
			'::error title=DST could not file abc::gh failed: 100%25 broken'
		);
	});

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

describe('the good-neighbour count', () => {
	it('counts only queued runs from the last hours: runs stuck in the queue for days are no CI waiting (#1578)', () => {
		const now = Date.parse('2026-11-13T12:00:00Z');
		const runs = [
			{ created_at: '2026-11-13T11:50:00Z' },
			{ created_at: '2026-11-13T09:30:00Z' },
			{ created_at: '2026-11-13T06:00:00Z' },
			...Array.from({ length: 195 }, () => ({ created_at: '2026-11-11T08:00:00Z' }))
		];
		expect(waiting_runs(runs, now)).toBe(2);
		expect(waiting_runs([], now)).toBe(0);
	});
});
