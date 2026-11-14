// THE CI PLAN (e2e.yml's `plan` job): which of the expensive jobs this push needs, so only those run,
// and only after the cheap ones pass.
//
// 1. A cheap path check first: a push that changes only changesets, Markdown outside the docs site,
//    or workflows other than the ones that run the tests needs no test run: `check` only, for
//    format and lint, which every PR runs whatever it touches (#1531; ci-plan-inputs.ts).
// 2. Then turbo is asked (`--dry=json`, `--affected` on a pull request, the hashed env each job sets):
//    - `check`: any package affected;
//    - `browsers`: the browser test projects (core, content, machine) affected;
//    - each e2e slice in each engine: an e2e task in it that is not a cache hit (a slice whose
//      tasks all replay is left out: its result is already known);
//    - `size`: core's build affected (pull requests only).
// Writes the outputs to $GITHUB_OUTPUT and a summary to $GITHUB_STEP_SUMMARY. Run by plain node.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { cheap_plan, format_lint_inputs } from './ci-plan-inputs.ts';
import { is_batched, is_stacked } from './ci-stack.ts';

type Slice = {
	name: string;
	id: string;
	filter: string;
	shard: string;
	adapters: boolean;
};

/** Region's full grid (packages/core `e2e`, scripts/region-grid.ts) in this many parts. */
const REGION_GRID_PARTS = ['1/4', '2/4', '3/4', '4/4'];

/** The e2e slices (one runner each): core's suite in three Playwright shards (it holds the
 *  adapter suite, so bun and wrangler are its alone), devtools' in two, Region's grid in its parts,
 *  every other suite in one. */
const SLICES: Slice[] = [
	{ name: 'core 1/3', id: 'core-1', filter: '--filter=palaestra', shard: '1/3', adapters: true },
	{ name: 'core 2/3', id: 'core-2', filter: '--filter=palaestra', shard: '2/3', adapters: true },
	{ name: 'core 3/3', id: 'core-3', filter: '--filter=palaestra', shard: '3/3', adapters: true },
	{
		name: 'devtools 1/2',
		id: 'devtools-1',
		filter: '--filter=@ogygia/devtools',
		shard: '1/2',
		adapters: false
	},
	{
		name: 'devtools 2/2',
		id: 'devtools-2',
		filter: '--filter=@ogygia/devtools',
		shard: '2/2',
		adapters: false
	},
	...REGION_GRID_PARTS.map((shard, i) => ({
		name: `region grid ${shard}`,
		id: `region-grid-${i + 1}`,
		filter: '--filter=@ogygia/core',
		shard,
		adapters: false
	})),
	{
		name: 'the rest',
		id: 'rest',
		filter: '--filter=!palaestra --filter=!@ogygia/devtools --filter=!@ogygia/core',
		shard: '',
		adapters: false
	}
];
const ENGINES = ['chromium', 'firefox', 'webkit'] as const;
/** The browser jobs beside `check` (which runs the browser projects in Chromium). */
const BROWSER_JOBS = ['firefox', 'webkit', 'firefox-stable'] as const;

const env = process.env;
const pull_request = env.EVENT === 'pull_request';
const labels = JSON.parse(env.LABELS || '[]') as string[];
// (a batched PR's e2e and browser jobs run on its batch, and `ci ok` stays red: ci-stack.ts)
const batched = pull_request && is_batched(labels);
// (a stacked PR's e2e and browser jobs run once, on its stack's PR into main: ci-stack.ts)
const stacked = pull_request && is_stacked(env.PR_BASE ?? '') && !labels.includes('ci:full');
const elsewhere = stacked || batched;
// (the base commit itself: a stacked PR's `base_ref` was seen to read `main` on CI, its base sha
// was right)
const base = env.BASE_SHA || (env.BASE_REF ? `origin/${env.BASE_REF}` : 'origin/main');
const out: Record<string, string> = {};
const summary: string[] = ['### CI plan', ''];

function output(name: string, value: unknown): void {
	out[name] = typeof value === 'string' ? value : JSON.stringify(value);
}

// (set before any early return: `ci ok` reads it on every path, so a batched PR is never green)
output('batched', batched ? 'true' : 'false');
if (batched)
	summary.push(
		'Batched (`batched` label): e2e and the opt-in sets run on its ci/integration-* batch; it lands only through that batch, so `ci ok` is red here.',
		''
	);

function done(): void {
	if (env.GITHUB_OUTPUT)
		appendFileSync(
			env.GITHUB_OUTPUT,
			Object.entries(out)
				.map(([k, v]) => `${k}=${v}\n`)
				.join('')
		);
	if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
	console.log(summary.join('\n'));
	console.log(out);
}

function nothing(why: string, format_lint = { check: false, check_hash: '' }): void {
	output('check', format_lint.check ? 'true' : 'false');
	output('browsers', []);
	output('e2e_chromium', []);
	output('e2e_engines', []);
	output('size', 'false');
	output('browsers_hash', '');
	output('check_hash', format_lint.check_hash);
	output('size_hash', '');
	summary.push(`Nothing to run: ${why}.`);
	done();
}

/** turbo's plan for `args`, with `extra` env (the hashed env a job sets). */
function dry(
	args: string[],
	extra: Record<string, string> = {}
): { task: string; taskId: string; hash: string; status: string }[] {
	const json = execFileSync(
		'pnpm',
		['exec', 'turbo', ...args, ...(pull_request ? ['--affected'] : []), '--dry=json'],
		{
			encoding: 'utf8',
			maxBuffer: 1 << 28,
			env: { ...env, TURBO_SCM_BASE: base, ...extra },
			stdio: ['ignore', 'pipe', 'inherit']
		}
	);
	const plan = JSON.parse(json) as {
		tasks?: {
			task: string;
			taskId: string;
			hash?: string;
			command?: string;
			cache?: { status?: string };
		}[];
	};
	// (a package with no such script is listed with no command: nothing runs for it)
	return (plan.tasks ?? [])
		.filter((t) => t.command !== '<NONEXISTENT>')
		.map((t) => ({
			task: t.task,
			taskId: t.taskId,
			hash: t.hash ?? '',
			status: t.cache?.status ?? 'MISS'
		}));
}

/** A short hash of `parts`, in order. */
/** The top-level entries of the pushed tree, one `git ls-tree` line each. */
function ls_tree(): string[] {
	return execFileSync('git', ['ls-tree', 'HEAD'], { encoding: 'utf8' }).split('\n');
}

function digest(parts: string[]): string {
	return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

/** A pass was remembered under `key` (an Actions cache entry a passing job saved). Without a token
 *  (a local run), nothing is remembered. */
function passed(key: string): boolean {
	if (!env.GH_TOKEN || !env.GITHUB_REPOSITORY) return false;
	try {
		const n = execFileSync(
			'gh',
			['api', `repos/${env.GITHUB_REPOSITORY}/actions/caches?key=${key}`, '--jq', '.total_count'],
			{ encoding: 'utf8' }
		).trim();
		return Number(n) > 0;
	} catch {
		return false; // ok: the lookup failed: the job runs, as if nothing were remembered
	}
}

if (env.HEAD_REF?.startsWith('changeset-release/')) {
	nothing('a version PR only bumps versions and changelogs');
	process.exit(0);
}

// 1. the cheap path check
let changed: string[] = [];
if (pull_request) {
	changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
		.split('\n')
		.filter(Boolean);
	summary.push(`${changed.length} file(s) changed against ${base}.`);
	if (cheap_plan(changed) === 'check') {
		// format and lint still read every file (#1531): only the test runs are left out
		const check_hash = digest(format_lint_inputs(ls_tree()));
		nothing('only changesets, Markdown or other workflows changed: format and lint only', {
			check: !passed(`check-pass-${check_hash}`),
			check_hash
		});
		process.exit(0);
	}
}

// 2. turbo's plan
const root_filters = ['--filter=./packages/*', '--filter=./packages/*/e2e/*', '--filter=./apps/*'];
const checks = dry(['run', 'check', ...root_filters], { OGYGIA_BROWSERS: 'chromium' }).filter(
	(t) => t.task === 'check'
);
const checks_left = checks.filter((t) => t.status !== 'HIT');
// Format and lint read the whole repo, root files turbo does not hash too (the lint and format
// config, the workflows): `check` passing is also remembered, under the check tasks' hashes and the
// root's own tree (every top-level entry but the packages and apps, internal/ included: #1531).
const root_tree = format_lint_inputs(ls_tree());
const check_hash = digest([...root_tree, ...checks.map((t) => `${t.taskId}:${t.hash}`)]);
const check = checks_left.length > 0 || !passed(`check-pass-${check_hash}`);
output('check', check ? 'true' : 'false');
output('check_hash', check_hash);
summary.push(
	`check: ${checks.length} task(s) affected, ${checks_left.length} to run${check && checks_left.length === 0 ? ' (format and lint: not passed on these inputs yet)' : ''}.`
);

// The browser jobs run vitest directly (no turbo task of their own), so a pass is remembered as a
// cache entry named after the inputs' hash (the browser projects' turbo hashes): a job whose
// inputs already passed is left out.
const browser_tasks = dry([
	'run',
	'check',
	'--filter=@ogygia/core',
	'--filter=@ogygia/content',
	'--filter=@ogygia/machine'
]).filter((t) => t.task === 'check');
const browsers_hash = digest(browser_tasks.map((t) => `${t.taskId}:${t.hash}`));
const browsers =
	browser_tasks.length === 0
		? []
		: BROWSER_JOBS.filter((b) => !passed(`browsers-pass-${b}-${browsers_hash}`));
output('browsers', elsewhere ? [] : browsers);
output('browsers_hash', browsers_hash);
summary.push(`browsers: ${browsers.join(', ') || 'none'} (inputs ${browsers_hash}).`);

const chromium: (Slice & { browser: string })[] = [];
const engines: (Slice & { browser: string })[] = [];
for (const browser of ENGINES)
	for (const slice of SLICES) {
		const e2e = dry(['run', 'e2e', '--concurrency=1', ...slice.filter.split(' ')], {
			E2E_SHARD: slice.shard,
			OGYGIA_BROWSERS: browser
		}).filter((t) => t.task === 'e2e');
		const left = e2e.filter((t) => t.status !== 'HIT');
		if (left.length > 0) (browser === 'chromium' ? chromium : engines).push({ ...slice, browser });
		summary.push(
			`e2e ${slice.name}, ${browser}: ${e2e.length} task(s), ${left.length} to run${left.length ? ` (${left.map((t) => t.taskId).join(', ')})` : ''}.`
		);
	}
output('e2e_chromium', elsewhere ? [] : chromium);
output('e2e_engines', elsewhere ? [] : engines);
if (stacked)
	summary.push(
		`Stacked on \`${env.PR_BASE}\`: no e2e or browser jobs here (they run on the integration PR or the stack's PR into main; \`ci:full\` runs them).`
	);

// (the size tool itself changing counts too: it measures both sides). Remembered like the browser
// jobs: the same core build against the same base passed before, so it is left out.
const core_builds = pull_request
	? dry(['run', 'build', '--filter=@ogygia/core...', '--filter=@ogygia/compiler...'])
	: [];
const size_hash = digest([
	env.BASE_SHA ?? '',
	...core_builds.map((t) => `${t.taskId}:${t.hash}`),
	...(changed.includes('apps/palaestra/e2e/bundle-size.ts') ? ['tool'] : [])
]);
const size =
	pull_request &&
	(changed.includes('apps/palaestra/e2e/bundle-size.ts') || core_builds.length > 0) &&
	!passed(`size-pass-${size_hash}`);
output('size', size ? 'true' : 'false');
output('size_hash', size_hash);
summary.push(`size: ${size ? 'core affected' : 'not needed'}.`);
done();
