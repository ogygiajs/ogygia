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
 * it counts the repository's queued runs; past the limit it waits (5 minutes at a time) and, if the
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
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Queued workflow runs in the repository now (null when it cannot tell: then it does not wait). */
function queued(): number | null {
	try {
		return Number(
			gh(['api', `repos/${REPO}/actions/runs?status=queued&per_page=1`, '--jq', '.total_count'])
		);
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
		.replace(/https:\/\/app\.test/g, '')
		.replace(/\?.*$/, '')
		.replace(/[0-9a-f]{8,}|\d+/g, '#')
		.replace(/\.[\w-]{8}\.(js|css)\b/g, '.#.$1');
	return createHash('sha1').update(`${f.oracle} ${about}`).digest('hex').slice(0, 10);
}

/** One batch of seeds through the pool; its findings. */
function batch(from: number): { findings: Finding[]; seeds: number; steps_per_second: number } {
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
	if (r.error) throw r.error;
	const out = JSON.parse(readFileSync(join(SIM, 'results.json'), 'utf8')) as {
		findings?: Finding[];
		steps_per_second: number;
		replay_leaks: number[];
	};
	if (out.replay_leaks.length)
		log(`replay leaks (the simulator's to fix): ${out.replay_leaks.join(', ')}`);
	return { findings: out.findings ?? [], seeds: BATCH, steps_per_second: out.steps_per_second };
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

/** Pushes `sim/found-<sig>`: this checkout's commit plus the test. */
function push_branch(f: Finding, sig: string): string {
	const branch = `sim/found-${sig}`;
	const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, stdio: 'pipe' });
	const head = git('rev-parse', 'HEAD').toString().trim();
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
	git(
		'push',
		'-q',
		`https://x-access-token:${env.GH_TOKEN}@github.com/${REPO}.git`,
		`${branch}:refs/heads/${branch}`
	);
	git('checkout', '-q', head);
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

function file(
	groups: Map<string, Finding[]>
): Array<{ sig: string; issue: number | null; repeat: boolean }> {
	const open = open_issues();
	const out: Array<{ sig: string; issue: number | null; repeat: boolean }> = [];
	let made = 0;
	for (const [sig, list] of groups) {
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
					`Seen again by the scheduled run: ${list.length} seed(s) (${list
						.slice(0, 10)
						.map((x) => x.seed)
						.join(', ')}).\n\n${mark}`
				]);
			out.push({ sig, issue: known.number, repeat: true });
			continue;
		}
		if (!FILE || made >= MAX_NEW) {
			out.push({ sig, issue: null, repeat: false });
			continue;
		}
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
		out.push({ sig, issue: Number(url.split('/').pop()), repeat: false });
	}
	return out;
}

async function main(): Promise<void> {
	const started = Date.now();
	let from = Number(env.DST_FROM ?? (Number(env.GITHUB_RUN_ID ?? 0) % 1_000_000) * 1000 + 1);
	let seeds = 0;
	let rate = 0;
	let stopped_early = false;
	const all: Finding[] = [];
	while (Date.now() < DEADLINE) {
		if (!(await neighbourly())) {
			stopped_early = true;
			break;
		}
		const b = batch(from);
		from += b.seeds;
		seeds += b.seeds;
		rate = b.steps_per_second;
		all.push(...b.findings);
		log(`${seeds} seeds, ${all.length} findings`);
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
		// (machine (name, state, event) coverage arrives with the coverage-guided search)
		coverage: null,
		findings: [...groups].map(([sig, list]) => ({
			sig,
			oracle: list[0].oracle,
			seeds: list.map((f) => f.seed),
			issue: filed.find((x) => x.sig === sig)?.issue ?? null,
			first_line: list[0].detail.split('\n')[0].slice(0, 200)
		}))
	};
	writeFileSync(RESULTS, JSON.stringify(results, null, '\t') + '\n');
	if (env.GITHUB_STEP_SUMMARY)
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			[
				'## Deterministic simulation',
				'',
				`${seeds} seeds × ${STEPS} actions in ${results.minutes} min (${rate} loop steps/s)${stopped_early ? ', stopped early to leave the runners to CI' : ''}.`,
				'',
				results.findings.length === 0
					? 'No new findings.'
					: [
							'| signature | oracle | seeds | issue |',
							'| --- | --- | --- | --- |',
							...results.findings.map(
								(f) =>
									`| ${f.sig} | ${f.oracle} | ${f.seeds.length} (first ${f.seeds[0]}) | ${f.issue ? `#${f.issue}` : 'not filed'} |`
							)
						].join('\n'),
				''
			].join('\n')
		);
	log(`done: ${seeds} seeds, ${groups.size} signatures`);
}

if (import.meta.main) await main();
