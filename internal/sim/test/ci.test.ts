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
	issue_for,
	quality_line,
	redact,
	seen,
	signature,
	unreached_in_every,
	waiting_runs
} from '../src/ci.ts';
import { describe as describe_action, type Action } from '../src/workload.ts';

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

/** Findings the scheduled runs filed over four days (2026-11-13 to 16), by the cause a person
 *  found when they read them: each group is one cause, filed as one issue per member. */
const TRIAGED: Record<string, ReadonlyArray<{ issue: number; oracle: string; detail: string }>> = {
	'the simulator settled before a host file read (#2010)': [
		{
			issue: 1918,
			oracle: 'page-errors',
			detail:
				'after tab 0: go to /mixed, press button #301 300 ms in: navigation: The operation was aborted.\n'
		},
		{
			issue: 1986,
			oracle: 'page-errors',
			detail: 'after tab 0: go to /mixed: navigation: The operation was aborted.\n'
		},
		{
			issue: 1987,
			oracle: 'page-errors',
			detail: 'after new tab at /mixed, behind: navigation: The operation was aborted.\n'
		},
		{
			issue: 1988,
			oracle: 'page-errors',
			detail: 'after tab 0: reload: navigation: The operation was aborted.\n'
		},
		{
			issue: 1989,
			oracle: 'page-errors',
			detail: 'after tab 0: back: navigation: The operation was aborted.\n'
		},
		{
			issue: 2001,
			oracle: 'page-errors',
			detail: 'after tab 0: forward: navigation: The operation was aborted.\n'
		}
	],
	'a declarative shadow root hydrated as a mismatch (#1929)': [
		[1980, 'after new tab at /dsd: https://app.test/dsd'],
		[1981, 'after tab 0: go to /dsd/b: https://app.test/dsd/b'],
		[1982, 'after tab 1: go to /dsd/b, press button #900 150 ms in: https://app.test/dsd/b'],
		[1983, 'after tab 1: go to /dsd: https://app.test/dsd'],
		[1984, 'after new tab at /dsd/b, behind: https://app.test/dsd/b']
	].map(([issue, head]) => ({
		issue: issue as number,
		oracle: 'ssr-hydrate',
		detail: `${head}: warn: https://svelte.dev/e/hydration_mismatch\nwarn: https://svelte.dev/e/hydration_mismatch\nwarn: [ogygia] https://ogygiajs.dev/e/hydration_discarded?entry=%2F_app%2Fogygia%2Fog-region.554c6dadc6fa.js&strict=https%3A%2F%2Fsvelte.dev%2Fe%2Fhydration_failed`
	})),
	'a press stored before wake replayed after the router went back (#2007)': [
		{
			issue: 2000,
			oracle: 'page-errors',
			detail:
				'after tab 0: click link #468: unhandled: Error: No cached query found. This should be impossible. Please file a bug report.\n'
		},
		{
			issue: 2007,
			oracle: 'page-errors',
			detail:
				'after tab 0: back: unhandled: Error: No cached query found. This should be impossible. Please file a bug report.\n'
		}
	],
	'the simulator read a document happy-dom had not written yet (#2011)': [
		{
			issue: 1993,
			oracle: 'page-errors',
			detail:
				'after tab 0: go to /router-depth/a/b/c: error: Failed to perform request to "https://app.test/router-depth/a/b/_app/immutable/chunks/D2GdFKTq.js". Status 404 .\nerror: Failed to perform request to "https://app.test/router-depth/a/b/_app/immutable/chunks/DJZGB_Vt.js". Status 404 .\nerror: Failed to perform request to "https://app.test/router-depth/a/b/_app/immutable/chunks/CRzLMJPS.js". Status 404 .'
		}
	],
	'a region resolved its code one folder too deep after back (#1995)': [
		{
			issue: 1995,
			oracle: 'page-errors',
			detail:
				'after tab 1: back: error: Failed to perform request to "https://app.test/lab/deep/_app/immutable/chunks/C5Ra7F4u.js". Status 404 .\nerror: Failed to perform request to "https://app.test/lab/deep/_app/immutable/chunks/90rmbuJx.js". Status 404 .\nerror: Failed to perform request to "https://app.test/lab/deep/_app/immutable/chunks/XKyaHtl9.js". Status 404 .'
		}
	],
	'#1990': [
		{
			issue: 1990,
			oracle: 'mpa-equivalence',
			detail: 'https://app.test/mixed\nat line 2:\n  title: '
		}
	],
	'#1992': [
		{
			issue: 1992,
			oracle: 'waste',
			detail:
				'https://app.test/static: said: warn: [ogygia] https://ogygiajs.dev/e/region_answer_denied?endpoint=%2F__ogygia__%3Fid%3Def6cf1a12aa0%26r%3D2141d477c436%26props%3DW3sic2FsdXRhdGlvbiI6MX0sIldlbGNvbWUiXQ%26exp%3D2049840000%26v%3D3%26s\n'
		}
	],
	'#1994': [
		{
			issue: 1994,
			oracle: 'mpa-equivalence',
			detail: 'https://app.test/soft-race\nat line 47:\n          <button data-soft-refresh="">'
		}
	],
	'#1996': [
		{
			issue: 1996,
			oracle: 'paint-gate',
			detail:
				'after tab 0: back: at rest: https://app.test/server: the island load gate opened before DOMContentLoaded\n'
		}
	],
	'#2002': [
		{
			issue: 2002,
			oracle: 'stuck',
			detail:
				'at rest: https://app.test/nest-matrix/kit: at rest, still wake#3 waking, wake#4 waking\n'
		}
	],
	'#2003': [
		{
			issue: 2003,
			oracle: 'mpa-equivalence',
			detail: 'https://app.test/about\nat line 47:\n            "Clock island:"'
		}
	],
	'#2005': [
		{
			issue: 2005,
			oracle: 'outage-recovery',
			detail: 'https://app.test/ctx-setcontext-kit/plain\nat line 13:\n      <div>'
		}
	],
	'#2006': [
		{
			issue: 2006,
			oracle: 'outage-recovery',
			detail: 'https://app.test/head-budget-kit/b\nat line 9:\n      <style>'
		}
	]
};

describe("a finding's cause", () => {
	it('is one signature for every finding a person traced to one cause, and a different one for each other cause (23 issues filed over four days for 13 causes)', () => {
		const by_cause = Object.entries(TRIAGED).map(([cause, list]) => ({
			cause,
			sigs: [...new Set(list.map((f) => signature(f)))]
		}));
		for (const { cause, sigs } of by_cause) expect(sigs, cause).toHaveLength(1);
		const owners = new Map<string, string>();
		for (const { cause, sigs } of by_cause) {
			expect(owners.get(sigs[0]), `${cause} shares its signature`).toBeUndefined();
			owners.set(sigs[0], cause);
		}
	});

	it('is the same whatever action showed it, for every kind of action the workload draws', () => {
		const actions: Record<Action['kind'], Action> = {
			click: { kind: 'click', tab: 0, nth: 3 },
			press: { kind: 'press', tab: 1, nth: 30 },
			goto: { kind: 'goto', tab: 0, path: '/a/b' },
			back: { kind: 'back', tab: 0 },
			forward: { kind: 'forward', tab: 0 },
			reload: { kind: 'reload', tab: 2 },
			open: { kind: 'open', path: '/a' },
			background: { kind: 'background', path: '/a' },
			offline: { kind: 'offline', tab: 0 },
			online: { kind: 'online', tab: 0 },
			wait: { kind: 'wait', ms: 500 },
			deploy: { kind: 'deploy' },
			away: { kind: 'away', tab: 0, nth: 2, ms: 20_000 },
			hurry: { kind: 'hurry', tab: 0, nth: 2, next: 5, after: 30 },
			hover: { kind: 'hover', tab: 0, nth: 4 },
			eager: { kind: 'eager', tab: 0, path: '/a', nth: 1, after: 150 },
			twice: { kind: 'twice', tab: 0, nth: 1, after: 40 },
			crowd: { kind: 'crowd', path: '/a', n: 4, spread: 200 },
			outage: { kind: 'outage', tab: 0, during: 'click', nth: 2, after: 30, lasts: 400 }
		};
		const bare = signature({ oracle: 'page-errors', detail: 'error: boom' });
		for (const a of Object.values(actions)) {
			const what = describe_action(a);
			expect(signature({ oracle: 'page-errors', detail: `after ${what}: error: boom` }), what).toBe(
				bare
			);
			expect(
				signature({ oracle: 'page-errors', detail: `after ${what}: at rest: error: boom` }),
				what
			).toBe(bare);
		}
	});
});

describe('an open issue', () => {
	const detail = 'after tab 0: back: unhandled: Error: No cached query found.';
	const sig = signature({ oracle: 'page-errors', detail });
	const filed = (body: string, comments: string[] = []) => ({
		number: 7,
		title: 'dst: page-errors (e4d33210c9)',
		body,
		comments: comments.map((c) => ({ body: c, createdAt: '2026-11-16T00:00:00Z' }))
	});

	it('is found by the signature its body or a comment names', () => {
		expect(issue_for([filed(`x\n\ndst-signature: ${sig}`)], sig)?.number).toBe(7);
		expect(issue_for([filed('a person wrote this', [`dst-signature: ${sig}`])], sig)?.number).toBe(
			7
		);
		expect(issue_for([filed('a person wrote this')], sig)).toBeUndefined();
	});

	it('filed under an older signature is found by the finding its body quotes (#2000 and #2007 were open together)', () => {
		const old = filed(
			[
				'The scheduled simulator run found something new. Oracle: `page-errors`.',
				'',
				'```',
				'after tab 0: click link #468: unhandled: Error: No cached query found.',
				'```',
				'',
				'dst-signature: a242f1d70e'
			].join('\n')
		);
		expect(issue_for([old], sig)?.number).toBe(7);
		expect(
			issue_for([{ ...old, title: 'dst: uncaught (a242f1d70e)' }], sig),
			'another oracle'
		).toBeUndefined();
	});
});

describe('where a cause was seen', () => {
	it('lists each seed with the action and page that showed it, the rest counted', () => {
		const list = Array.from({ length: 23 }, (_, i) => ({
			seed: 100 + i,
			detail: `after tab 0: go to /dsd/${i}: https://app.test/dsd/${i}: warn: x\nmore`
		}));
		const said = seen(list);
		expect(said.split('\n')[0]).toBe(
			'- seed 100: after tab 0: go to /dsd/0: https://app.test/dsd/0'
		);
		expect(said.split('\n')).toHaveLength(21);
		expect(said.split('\n')[20]).toBe('- and 3 more seeds');
		expect(seen([{ seed: 5, detail: 'https://app.test/about\nat line 47:' }])).toBe(
			'- seed 5: https://app.test/about'
		);
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
