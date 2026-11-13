/**
 * THE ALWAYS-ON RUN (.github/workflows/dst.yml): seeds, batch after batch, until the deadline; then
 * each NEW finding filed once. Private tooling, run by the scheduled workflow only.
 *
 *   node --experimental-vm-modules src/ci.ts
 *
 * Environment: DST_DEADLINE (epoch ms to stop starting batches), DST_STEPS (actions per seed,
 * default 40), DST_BATCH (seeds per batch, default 200), DST_FROM (first seed; default from the
 * run id, so each run covers new seeds), DST_QUEUE_LIMIT (queued runs in the repository past which
 * this run yields, default 50), DST_FILE ('1' to file issues and push branches), GH_TOKEN,
 * GITHUB_REPOSITORY, GITHUB_STEP_SUMMARY, DST_RESULTS (where the results file goes).
 *
 * A GOOD NEIGHBOUR: the runners are shared with CI. Before each batch, at most every 20 minutes,
 * it counts the repository's queued runs from the last 3 hours (one queued longer is stuck, not
 * waiting: #1578); past the limit it waits (5 minutes at a time) and, if the
 * queue has not drained by the deadline, stops early. It never starves CI.
 *
 * FILING: a finding's SIGNATURE is its oracle plus what it is about, with the run-specific parts
 * (numbers, hashes, the action that showed it) taken out, so the same bug found by two seeds is one
 * signature. An open `dst` issue carries its signature (`dst-signature: <sig>`); a repeat adds a
 * comment with the count, at most once a day, never a new issue. A new one gets an issue (labels
 * `bug`, `dst`) and a branch `sim/found-<sig>` with a seeded test that fails while it stands. At most
 * MAX_NEW issues per run: past that, a regression of the simulator itself is the likelier story.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { join } from 'node:path';

const SIM = join(import.meta.dirname, '..');
const ROOT = join(SIM, '..', '..');
const env = process.env;
const DEADLINE = Number(env.DST_DEADLINE ?? Date.now() + 10 * 60_000);
const STEPS = Number(env.DST_STEPS ?? 40);
const BATCH = Number(env.DST_BATCH ?? 200);
const QUEUE_LIMIT = Number(env.DST_QUEUE_LIMIT ?? 50);
const FILE = env.DST_FILE === '1';
const REPO = env.GITHUB_REPOSITORY ?? 'ogygiajs/ogygia';
const RESULTS = env.DST_RESULTS ?? join(SIM, 'dst-results.json');
const MAX_NEW = 5;
const DAY = 24 * 3600_000;

interface Finding {
	seed: number;
	steps: number;
	oracle: string;
	detail: string;
	faults: string[];
	actions: string[];
	trace_tail: string[];
}

const log = (line: string) => console.log(`[dst] ${line}`);

function gh(args: string[]): string {
	return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** How long a queued run counts as CI waiting for a runner: one queued longer is stuck, not waiting
 *  (#1578: ~195 runs GitHub can neither cancel nor delete stayed queued for days). */
const WAITING_MS = 3 * 3600_000;

/** Of `runs` (queued, newest first), how many are CI waiting for a runner at `now`: created in the
 *  last WAITING_MS. */
export function waiting_runs(runs: readonly { created_at: string }[], now: number): number {
	return runs.filter((r) => now - Date.parse(r.created_at) <= WAITING_MS).length;
}

/** Queued workflow runs in the repository that wait for a runner now (null when it cannot tell:
 *  then it does not wait). The newest 100: past the limit either way. */
function queued(): number | null {
	try {
		const runs = JSON.parse(
			gh([
				'api',
				`repos/${REPO}/actions/runs?status=queued&per_page=100`,
				'--jq',
				'[.workflow_runs[] | {created_at}]'
			])
		) as { created_at: string }[];
		return waiting_runs(runs, Date.now());
	} catch {
		return null; // ok: no token or no network (a local run); the run goes on
	}
}

let last_check = 0;
/** Waits while CI needs the runners; false when the deadline came first (stop early). */
async function neighbourly(): Promise<boolean> {
	if (Date.now() - last_check < 20 * 60_000) return true;
	for (;;) {
		last_check = Date.now();
		const n = queued();
		if (n === null || n <= QUEUE_LIMIT) return true;
		log(`${n} runs queued (limit ${QUEUE_LIMIT}): yielding to CI`);
		if (Date.now() + 5 * 60_000 > DEADLINE) return false;
		await new Promise((r) => setTimeout(r, 5 * 60_000));
	}
}

/** What a finding is about, without what changes from seed to seed. */
export function signature(f: Pick<Finding, 'oracle' | 'detail'>): string {
	const about = f.detail
		.replace(/^(at rest: )?after [^:]+: /, '')
		.split('\n')
		.slice(0, f.oracle === 'mpa-equivalence' ? 1 : 2)
		.join(' ')
		// (a stack frame's place, `(file:line:column)`: a rebuilt app moves every file and position,
		// and the frame's function says where it was; test/ci.test.ts)
		.replace(/\s*\(?\S+:\d+:\d+\)?/g, '')
		.replace(/https:\/\/app\.test/g, '')
		.replace(/\?.*$/, '')
		.replace(/[0-9a-f]{8,}|\d+/g, '#')
		.replace(/\.[\w-]{8}\.(js|css)\b/g, '.#.$1');
	return createHash('sha1').update(`${f.oracle} ${about}`).digest('hex').slice(0, 10);
}

/** What one batch's CLI wrote. */
interface BatchOut {
	findings?: Finding[];
	steps_per_second: number;
	replay_leaks: number[];
	coverage?: { unreached_recovery?: string[] };
}

/**
 * A batch's results, or why there are none: the CLI exits 0 (nothing found) or 1 (found something)
 * having written its file; any other end (a crash, 2 for a missing build, 3 for a hung worker) or no
 * file means the batch did not run, and its seeds are not counted. (The file is removed before each
 * batch, so it is never the batch before's.)
 */
export function batch_result(
	status: number | null,
	signal: string | null,
	read: () => string | null
): { ran: BatchOut } | { failed: string } {
	if (status !== 0 && status !== 1)
		return { failed: `the simulator ended with ${signal ?? `exit code ${status}`}` };
	const text = read();
	if (text === null) return { failed: 'the simulator wrote no results' };
	return { ran: JSON.parse(text) as BatchOut };
}

/** The recovery steps every batch missed: one any batch reached is reached. */
export function unreached_in_every(lists: readonly (readonly string[])[]): string[] {
	if (lists.length === 0) return [];
	return lists[0].filter((s) => lists.every((l) => l.includes(s))).sort();
}

/** One batch of seeds through the pool; its findings, or why it failed. */
function batch(from: number):
	| {
			findings: Finding[];
			seeds: number;
			steps_per_second: number;
			unreached_recovery: string[];
	  }
	| { failed: string } {
	const file = join(SIM, 'results.json');
	rmSync(file, { force: true });
	const r = spawnSync(
		process.execPath,
		[
			'--experimental-vm-modules',
			'--no-warnings',
			'src/cli.ts',
			'--from',
			String(from),
			'--runs',
			String(BATCH),
			'--steps',
			String(STEPS)
		],
		{ cwd: SIM, stdio: ['ignore', 'inherit', 'inherit'] }
	);
	if (r.error) return { failed: `the simulator did not start: ${r.error.message}` };
	const result = batch_result(r.status, r.signal, () =>
		existsSync(file) ? readFileSync(file, 'utf8') : null
	);
	if (!('ran' in result)) return result;
	const out = result.ran;
	if (out.replay_leaks.length)
		log(`replay leaks (the simulator's to fix): ${out.replay_leaks.join(', ')}`);
	return {
		findings: out.findings ?? [],
		seeds: BATCH,
		steps_per_second: out.steps_per_second,
		unreached_recovery: out.coverage?.unreached_recovery ?? []
	};
}

/** The seeded test a found branch carries: fails while the finding stands. */
function test_source(f: Finding, sig: string): string {
	return `// FOUND BY THE ALWAYS-ON SIMULATOR (seed ${f.seed}, ${f.steps} actions, faults: ${f.faults.join(',') || 'none'}).
// Signature ${sig}: ${f.oracle}. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: ${sig}', () => {
	it('seed ${f.seed} no longer finds ${f.oracle} ${sig}', async () => {
		const r = await run(${f.seed}, ${f.steps});
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '${sig}')).toEqual([]);
	}, 120_000);
});
`;
}

/** `text` with every secret in it replaced (a failed command's message names its arguments and
 *  its output). */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
	for (const s of secrets) if (s) text = text.split(s).join('***');
	return text;
}

/** The first of `sim/found-<sig>`, `…-2`, `…-3`, … that is not taken: a signature filed before (its
 *  issue closed, or the issue failed after the push) keeps its old branch, and the new finding gets
 *  its own, so a push is always a new branch and never needs to replace one. */
export function free_branch(sig: string, taken: ReadonlySet<string>): string {
	const base = `sim/found-${sig}`;
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The token reaches git through its environment (an auth header in `GIT_CONFIG_*`), never its
 *  arguments, so no command line or error carries it. */
function git_env(): NodeJS.ProcessEnv {
	if (!env.GH_TOKEN) return env;
	const basic = Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString('base64');
	return {
		...env,
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
		GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`
	};
}

/** Runs git in the checkout; a failure's message has every secret taken out. */
function git(...a: string[]): string {
	try {
		return execFileSync('git', a, { cwd: ROOT, stdio: 'pipe', env: git_env() }).toString();
	} catch (error) {
		const e = error as { message?: string; stderr?: Buffer | string };
		const said = `${e.message ?? String(error)}\n${e.stderr?.toString() ?? ''}`;
		const basic = env.GH_TOKEN
			? Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString('base64')
			: undefined;
		throw new Error(redact(`git ${a[0]} failed: ${said}`, [env.GH_TOKEN, basic]));
	}
}

/**
 * Pushes a new `sim/found-<sig>[-n]` branch: this checkout's commit plus the test. The checkout is
 * back on its commit afterwards, whatever happened, so the next finding's branch starts there too.
 */
function push_branch(f: Finding, sig: string): string {
	const remote = `https://github.com/${REPO}.git`;
	const taken = new Set(
		git('ls-remote', '--heads', remote)
			.split('\n')
			.map((l) => l.split('refs/heads/')[1])
			.filter((b): b is string => !!b && b.startsWith(`sim/found-${sig}`))
	);
	const branch = free_branch(sig, taken);
	const head = git('rev-parse', 'HEAD').trim();
	try {
		git('checkout', '-q', '-B', branch, head);
		const dir = join(SIM, 'test', 'found');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${sig}.test.ts`), test_source(f, sig));
		git('add', join(dir, `${sig}.test.ts`));
		git(
			'-c',
			'user.name=ogygia-dst',
			'-c',
			'user.email=dst@users.noreply.github.com',
			'commit',
			'-q',
			'-m',
			`test(sim): found ${sig}: ${f.oracle} (seed ${f.seed})`
		);
		git('push', '-q', remote, `${branch}:refs/heads/${branch}`);
	} finally {
		git('checkout', '-q', '-f', head);
	}
	return branch;
}

interface Open {
	number: number;
	body: string;
	comments: Array<{ body: string; createdAt: string }>;
}

function open_issues(): Open[] {
	try {
		return JSON.parse(
			gh([
				'issue',
				'list',
				'-R',
				REPO,
				'-l',
				'dst',
				'--state',
				'open',
				'--limit',
				'200',
				'--json',
				'number,body,comments'
			])
		);
	} catch {
		return [];
	}
}

type Filed = { sig: string; issue: number | null; repeat: boolean; error?: string };

/** Files each signature; one that fails is reported with why (secrets taken out), and the others
 *  are still filed. */
function file(groups: Map<string, Finding[]>): Filed[] {
	const out: Filed[] = [];
	const ask = file_one(open_issues());
	for (const [sig, list] of groups) {
		try {
			out.push(ask(sig, list));
		} catch (error) {
			const why = redact(String((error as Error)?.message ?? error), [env.GH_TOKEN]);
			log(`filing ${sig} failed: ${why.split('\n')[0]}`);
			out.push({ sig, issue: null, repeat: false, error: why.slice(0, 500) });
		}
	}
	return out;
}

function file_one(open: Open[]): (sig: string, list: Finding[]) => Filed {
	let made = 0;
	return (sig, list) => {
		const f = list[0];
		const mark = `dst-signature: ${sig}`;
		// (an issue a person filed names its signature in a comment)
		const known = open.find(
			(i) => i.body.includes(mark) || i.comments.some((c) => c.body.includes(mark))
		);
		if (known) {
			const ours = known.comments.filter((c) => c.body.includes(mark));
			const recent = ours.some((c) => Date.now() - Date.parse(c.createdAt) < DAY);
			if (!recent && FILE)
				gh([
					'issue',
					'comment',
					String(known.number),
					'-R',
					REPO,
					'-b',
					[
						`Seen again by the scheduled run: ${list.length} seed(s) (${list
							.slice(0, 10)
							.map((x) => x.seed)
							.join(', ')}).`,
						'',
						mark
					].join('\n')
				]);
			return { sig, issue: known.number, repeat: true };
		}
		if (!FILE || made >= MAX_NEW) return { sig, issue: null, repeat: false };
		made++;
		const branch = push_branch(f, sig);
		const body = [
			`The scheduled simulator run found something new. Oracle: \`${f.oracle}\`. Not yet read by a person: the description below is the oracle's, and the next step is to shrink it and say in plain words what a user sees.`,
			'',
			'```',
			f.detail.slice(0, 3000),
			'```',
			'',
			`Seed ${f.seed}, ${f.steps} actions, network faults: ${f.faults.join(', ') || 'none'}. Seen in ${list.length} seed(s) this run: ${list
				.slice(0, 10)
				.map((x) => x.seed)
				.join(', ')}.`,
			'',
			`Replay: \`pnpm -C internal/sim sim --seed ${f.seed} --steps ${f.steps}\` (add \`--step N\` for the trace up to action N).`,
			'',
			'<details><summary>Actions</summary>',
			'',
			f.actions.map((a, i) => `${i + 1}. ${a}`).join('\n'),
			'</details>',
			'',
			'<details><summary>Trace tail</summary>',
			'',
			'```',
			f.trace_tail.join('\n'),
			'```',
			'</details>',
			'',
			`Failing test: \`internal/sim/test/found/${sig}.test.ts\` on branch \`${branch}\`.`,
			'',
			mark
		].join('\n');
		const url = gh([
			'issue',
			'create',
			'-R',
			REPO,
			'-l',
			'bug',
			'-l',
			'dst',
			'-t',
			`dst: ${f.oracle} (${sig})`,
			'-b',
			body
		]).trim();
		return { sig, issue: Number(url.split('/').pop()), repeat: false };
	};
}

/** The two quality numbers: the machine steps the ledger accounts for (this run's sweep), and the
 *  latest finished mutation run's kill rate, its date and how far through its list it got. */
export function quality_line(
	sweep: { accounted: number; total: number } | null,
	mutation: { killed: number; judged: number; total: number; rate: number; at: string } | null
): string {
	const steps =
		sweep === null
			? 'no sweep this run'
			: `${sweep.accounted}/${sweep.total} (${Math.round((sweep.accounted / sweep.total) * 1000) / 10}%)`;
	const kill =
		mutation === null
			? 'no finished run yet'
			: `${mutation.rate}% (${mutation.killed}/${mutation.judged} judged of ${mutation.total}, ${mutation.at.slice(0, 10)})`;
	return `steps accounted: ${steps}; mutation kill rate: ${kill}`;
}

/** A JSON file's value, or null when it is not there or not JSON (its last line, for a .jsonl). */
function read_json<T>(file: string | undefined): T | null {
	if (file === undefined || !existsSync(file)) return null;
	try {
		const lines = readFileSync(file, 'utf8').trim().split('\n');
		return JSON.parse(file.endsWith('.jsonl') ? lines[lines.length - 1] : lines.join('\n')) as T;
	} catch {
		return null; // ok: a broken file reads as none, and the line says so
	}
}

async function main(): Promise<void> {
	const quality = quality_line(read_json(env.DST_SWEEP), read_json(env.DST_MUTATION));
	log(quality);
	const started = Date.now();
	let from = Number(env.DST_FROM ?? (Number(env.GITHUB_RUN_ID ?? 0) % 1_000_000) * 1000 + 1);
	let seeds = 0;
	let rate = 0;
	let stopped_early = false;
	let failed: string | null = null;
	const all: Finding[] = [];
	/** Each batch's recovery steps no run of it reached. */
	const unreached: string[][] = [];
	// (a results file is this run's or none: one a run before left is never read as this one's)
	rmSync(RESULTS, { force: true });
	while (Date.now() < DEADLINE) {
		if (!(await neighbourly())) {
			stopped_early = true;
			break;
		}
		const b = batch(from);
		// (a batch that did not run ends the run: what ran is still filed and reported, and the job
		// fails so a person looks)
		if ('failed' in b) {
			failed = `seeds ${from} to ${from + BATCH - 1}: ${b.failed}`;
			log(`batch failed, ${failed}`);
			break;
		}
		from += b.seeds;
		seeds += b.seeds;
		rate = b.steps_per_second;
		all.push(...b.findings);
		unreached.push(b.unreached_recovery);
		log(`${seeds} seeds, ${all.length} findings; ${quality}`);
	}
	const groups = new Map<string, Finding[]>();
	for (const f of all) {
		const sig = signature(f);
		groups.set(sig, [...(groups.get(sig) ?? []), f]);
	}
	const filed = file(groups);
	const results = {
		at: new Date().toISOString(),
		ref: env.GITHUB_REF_NAME ?? null,
		sha: env.GITHUB_SHA ?? null,
		minutes: Math.round((Date.now() - started) / 60_000),
		seeds,
		steps: STEPS,
		steps_per_second: rate,
		stopped_early,
		failed,
		quality,
		// (the recovery steps no batch reached: each wants a point, a fault or an app shape)
		coverage: { unreached_recovery: unreached_in_every(unreached) },
		findings: [...groups].map(([sig, list]) => ({
			sig,
			oracle: list[0].oracle,
			seeds: list.map((f) => f.seed),
			issue: filed.find((x) => x.sig === sig)?.issue ?? null,
			filing_error: filed.find((x) => x.sig === sig)?.error ?? null,
			first_line: list[0].detail.split('\n')[0].slice(0, 200)
		}))
	};
	writeFileSync(RESULTS, `${JSON.stringify(results, null, '\t')}\n`);
	if (env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			[
				'## Deterministic simulation',
				'',
				`${seeds} seeds × ${STEPS} actions in ${results.minutes} min (${rate} loop steps/s)${stopped_early ? ', stopped early to leave the runners to CI' : ''}.`,
				'',
				`${quality.charAt(0).toUpperCase()}${quality.slice(1)}.`,
				'',
				failed ? `**A batch failed** (${failed}): the run stopped there.\n` : '',
				results.findings.length === 0
					? 'No new findings.'
					: [
							'| signature | oracle | seeds | issue |',
							'| --- | --- | --- | --- |',
							...results.findings.map(
								(f) =>
									`| ${f.sig} | ${f.oracle} | ${f.seeds.length} (first ${f.seeds[0]}) | ${f.issue ? `#${f.issue}` : f.filing_error ? 'filing failed' : 'not filed'} |`
							)
						].join('\n'),
				'',
				results.coverage.unreached_recovery.length === 0
					? 'Every recovery step was reached.'
					: [
							`### Recovery steps no run reached (${results.coverage.unreached_recovery.length})`,
							'',
							'Each wants a buggify point, a fault or an app shape that leads there.',
							'',
							...results.coverage.unreached_recovery.map((s) => `- \`${s}\``)
						].join('\n'),
				''
			].join('\n')
		);
	log(`done: ${seeds} seeds, ${groups.size} signatures`);
	// (a failed batch or filing fails the job, after the results and the summary are written)
	if (failed || filed.some((x) => x.error)) process.exitCode = 1;
}

if (import.meta.main) await main();
