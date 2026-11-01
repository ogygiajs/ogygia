// Every e2e suite on ONE machine, as fast as it goes: `pnpm test:e2e` (or `pnpm test:e2e palaestra
// devtools` for some suites). Suites run side by side in lanes, one Playwright run at a time per
// lane; the big suites are split by spec file across lanes, balanced by how long each file took last
// time. CI splits across machines instead (.github/workflows/e2e.yml); this is the local twin.
//
// What makes running them together safe:
// - Ports. Whole suites keep their own (unique across the repo). A split suite's lane moves every
//   port it binds by `E2E_PORT_OFFSET` (lane × 5000, through `port()` in servers.ts).
// - Builds. A split suite is built ONCE before its lanes start (they run with `E2E_NO_BUILD`), since
//   each lane would otherwise rebuild the same app folder at the same time.
// - Shared dev servers. A few specs run `vite dev` on an app another spec also runs it on (the dep
//   optimizer cache, `.svelte-kit`, source files the spec edits): EXCLUSIVE keeps each set in one lane,
//   one after another. A new spec that runs `vite dev` on a shared app belongs in that list.
//
// Logs: node_modules/.cache/ogygia-e2e/logs (one per Playwright run); a failure prints its tail.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { REPO } from './paths.ts';

/** Suites split by spec file across lanes, and how each is built once before its lanes start. */
const SPLIT: Record<string, { cmd: string[]; cwd: string }> = {
	'apps/palaestra': { cmd: ['node', 'e2e/e2e-build.ts'], cwd: 'apps/palaestra' },
	'packages/devtools': {
		cmd: ['node', join(REPO, 'packages/tooling/src/e2e/build.ts')],
		cwd: 'packages/devtools/e2e/app'
	}
};

/** Sets that must never overlap: each entry is a spec file, or a whole (unsplit) suite's directory. */
const EXCLUSIVE: string[][] = [
	// `vite dev` on the palaestra itself (two of them also edit its source files)
	[
		'apps/palaestra/e2e/dev-csr-toggle.spec.ts',
		'apps/palaestra/e2e/dev-hole-hmr.spec.ts',
		'apps/palaestra/e2e/dev-stale-dep-reload.spec.ts',
		'apps/palaestra/e2e/shared-page-module.spec.ts'
	],
	// `vite dev` on the devtools lab (packages/devtools/e2e/app)
	['packages/devtools/e2e/devtools.spec.ts', 'packages/testing']
];

const PORT_STEP = 5000;
const CACHE = join(REPO, 'node_modules/.cache/ogygia-e2e');
const TIMINGS = join(CACHE, 'timings.json');
const LOGS = join(CACHE, 'logs');

interface Suite {
	/** Repo-relative directory (holds playwright.config.ts). */
	dir: string;
	name: string;
	files: string[];
	split: boolean;
}

/** One Playwright run: a suite, and the spec files of it (all of them when `files` is null). */
interface Run {
	suite: Suite;
	files: string[] | null;
}

/** What one lane takes: runs that go one after another. */
interface Unit {
	runs: Run[];
	weight: number;
}

function find_suites(): Suite[] {
	const out: Suite[] = [];
	for (const root of ['apps', 'packages']) {
		for (const entry of readdirSync(join(REPO, root), { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = `${root}/${entry.name}`;
			const pkg_file = join(REPO, dir, 'package.json');
			if (!existsSync(join(REPO, dir, 'playwright.config.ts')) || !existsSync(pkg_file)) continue;
			const pkg = JSON.parse(readFileSync(pkg_file, 'utf8'));
			if (!pkg.scripts?.e2e) continue;
			const files = readdirSync(join(REPO, dir, 'e2e'))
				.filter((f) => f.endsWith('.spec.ts'))
				.map((f) => `${dir}/e2e/${f}`)
				.sort();
			out.push({ dir, name: pkg.name, files, split: dir in SPLIT });
		}
	}
	return out;
}

function read_timings(): Record<string, number> {
	try {
		return JSON.parse(readFileSync(TIMINGS, 'utf8'));
	} catch {
		return {};
	}
}

/** A file's (or a whole suite's) last time, or a guess from its test count on a first run. */
function weight_of(key: string, timings: Record<string, number>, files: string[]): number {
	if (timings[key]) return timings[key];
	let tests = 0;
	for (const f of files)
		tests += (readFileSync(join(REPO, f), 'utf8').match(/\btest\(/g) ?? []).length;
	return Math.max(1, tests) * 3000;
}

function plan(suites: Suite[], timings: Record<string, number>): Unit[] {
	const by_dir = new Map(suites.map((s) => [s.dir, s]));
	const suite_of = (file: string) => suites.find((s) => file.startsWith(`${s.dir}/`));
	const claimed = new Set<string>();
	const units: Unit[] = [];

	for (const set of EXCLUSIVE) {
		const runs: Run[] = [];
		let weight = 0;
		for (const item of set) {
			const whole = by_dir.get(item);
			if (whole) {
				runs.push({ suite: whole, files: null });
				weight += weight_of(whole.dir, timings, whole.files);
				claimed.add(whole.dir);
				continue;
			}
			const suite = suite_of(item);
			if (!suite || !suite.files.includes(item)) continue; // filtered out, or gone
			const last = runs.at(-1);
			if (last && last.suite === suite && last.files) last.files.push(item);
			else runs.push({ suite, files: [item] });
			weight += weight_of(item, timings, [item]);
			claimed.add(item);
		}
		if (runs.length) units.push({ runs, weight });
	}

	for (const suite of suites) {
		if (claimed.has(suite.dir)) continue;
		if (!suite.split) {
			units.push({
				runs: [{ suite, files: null }],
				weight: weight_of(suite.dir, timings, suite.files)
			});
			continue;
		}
		for (const file of suite.files) {
			if (claimed.has(file)) continue;
			units.push({ runs: [{ suite, files: [file] }], weight: weight_of(file, timings, [file]) });
		}
	}
	return units;
}

/** Longest first, each onto the least-loaded lane; then a lane's runs of one suite merge into one. */
function assign(units: Unit[], lanes: number): Run[][] {
	const loads = Array.from({ length: lanes }, () => ({ total: 0, units: [] as Unit[] }));
	for (const unit of [...units].sort((a, b) => b.weight - a.weight)) {
		const lane = loads.reduce((min, l) => (l.total < min.total ? l : min));
		lane.units.push(unit);
		lane.total += unit.weight;
	}
	return loads
		.filter((l) => l.units.length)
		.map((l) => {
			const runs: Run[] = [];
			// whole suites first: they need no prebuild, so a lane starts working at once
			const ordered = [...l.units].sort(
				(a, b) => Number(a.runs[0].suite.split) - Number(b.runs[0].suite.split)
			);
			for (const unit of ordered) {
				for (const run of unit.runs) {
					const merge =
						run.files &&
						runs.find((r) => r.suite === run.suite && r.files && unit.runs.length === 1);
					if (merge && merge.files) merge.files.push(...run.files!);
					else runs.push({ suite: run.suite, files: run.files ? [...run.files] : null });
				}
			}
			return runs;
		});
}

const children = new Set<ChildProcess>();
function kill_all() {
	for (const child of children) {
		try {
			if (child.pid) process.kill(-child.pid, 'SIGTERM');
		} catch {
			// already gone
		}
	}
}
process.on('SIGINT', () => {
	kill_all();
	process.exit(130);
});

function run_process(
	cmd: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	log_file: string
): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(cmd[0], cmd.slice(1), {
			cwd,
			env,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		children.add(child);
		const chunks: Buffer[] = [];
		child.stdout!.on('data', (d: Buffer) => chunks.push(d));
		child.stderr!.on('data', (d: Buffer) => chunks.push(d));
		child.on('close', (code) => {
			children.delete(child);
			writeFileSync(log_file, Buffer.concat(chunks));
			resolve(code ?? 1);
		});
	});
}

const fmt = (ms: number) =>
	ms >= 60_000
		? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
		: `${(ms / 1000).toFixed(1)}s`;

function tail(file: string, n = 40): string {
	return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n).join('\n');
}

interface Totals {
	passed: number;
	failed: number;
	flaky: number;
	skipped: number;
}

/** Fold one Playwright JSON report into the totals and the per-file timings. */
function read_report(file: string, totals: Totals, timings: Record<string, number>): void {
	if (!existsSync(file)) return;
	const report = JSON.parse(readFileSync(file, 'utf8'));
	totals.passed += report.stats?.expected ?? 0;
	totals.failed += report.stats?.unexpected ?? 0;
	totals.flaky += report.stats?.flaky ?? 0;
	totals.skipped += report.stats?.skipped ?? 0;
	const root: string = report.config?.rootDir ?? '';
	const per_file: Record<string, number> = {};
	const walk = (suite: { file?: string; specs?: unknown[]; suites?: unknown[] }) => {
		for (const spec of (suite.specs ?? []) as {
			file: string;
			tests: { results: { duration: number }[] }[];
		}[]) {
			const key = relative(REPO, join(root, spec.file));
			for (const t of spec.tests)
				for (const r of t.results) per_file[key] = (per_file[key] ?? 0) + r.duration;
		}
		for (const child of (suite.suites ?? []) as never[]) walk(child);
	};
	for (const suite of report.suites ?? []) walk(suite);
	Object.assign(timings, per_file);
}

async function main() {
	const args = process.argv.slice(2);
	const lanes_flag = args.indexOf('--lanes');
	const lanes =
		lanes_flag >= 0
			? Number(args.splice(lanes_flag, 2)[1])
			: Math.max(2, Math.floor(availableParallelism() / 2));
	const wanted = args;

	let suites = find_suites();
	if (wanted.length)
		suites = suites.filter((s) => wanted.some((w) => s.name === w || s.dir.endsWith(`/${w}`)));
	if (!suites.length) throw new Error(`no e2e suite matches ${wanted.join(', ')}`);

	mkdirSync(LOGS, { recursive: true });
	const timings = read_timings();
	const plan_lanes = assign(plan(suites, timings), lanes);
	const started = Date.now();

	console.log('▸ Building the libraries (turbo, cached)');
	const libs = spawnSync(
		'pnpm',
		['turbo', 'run', 'build', '--filter=./packages/*', '--output-logs=errors-only'],
		{
			cwd: REPO,
			stdio: 'inherit'
		}
	);
	if (libs.status !== 0) process.exit(libs.status ?? 1);

	// each split suite built once, side by side; its lanes wait for it
	const prebuilds = new Map<string, Promise<boolean>>();
	for (const suite of suites.filter((s) => s.split)) {
		const { cmd, cwd } = SPLIT[suite.dir];
		const log = join(LOGS, `build-${suite.dir.replace(/\//g, '-')}.log`);
		const t0 = Date.now();
		prebuilds.set(
			suite.dir,
			run_process(cmd, join(REPO, cwd), process.env, log).then((code) => {
				if (code !== 0) console.log(`✗ build ${suite.name} failed\n${tail(log)}\n  log: ${log}`);
				else console.log(`  built ${suite.name} (${fmt(Date.now() - t0)})`);
				return code === 0;
			})
		);
	}

	console.log(
		`▸ ${suites.length} suites in ${plan_lanes.length} lanes` +
			(Object.keys(timings).length ? '' : ' (first run: balanced by test count)')
	);
	const totals: Totals = { passed: 0, failed: 0, flaky: 0, skipped: 0 };
	const fresh: Record<string, number> = {};
	const failures: string[] = [];

	await Promise.all(
		plan_lanes.map(async (runs, lane) => {
			for (const run of runs) {
				const { suite } = run;
				if (suite.split && !(await prebuilds.get(suite.dir))) {
					failures.push(`${suite.name}: build failed`);
					continue;
				}
				const label = run.files ? `${suite.name} (${run.files.length} files)` : suite.name;
				const id = `lane${lane}-${suite.dir.replace(/\//g, '-')}`;
				const log = join(LOGS, `${id}.log`);
				const report = join(LOGS, `${id}.json`);
				const env: NodeJS.ProcessEnv = {
					...process.env,
					PLAYWRIGHT_JSON_OUTPUT_FILE: report,
					// lanes do the splitting here; a CI shard setting must not split each run again
					E2E_SHARD: '',
					E2E_LANE: String(lane),
					...(suite.split
						? { E2E_NO_BUILD: '1', E2E_PORT_OFFSET: String(lane * PORT_STEP) }
						: { E2E_PORT_OFFSET: '0' })
				};
				const files = run.files?.map((f) => join(REPO, f)) ?? [];
				const t0 = Date.now();
				const code = await run_process(
					['pnpm', 'exec', 'playwright', 'test', ...files, '--reporter=list,json'],
					join(REPO, suite.dir),
					env,
					log
				);
				const ms = Date.now() - t0;
				read_report(report, totals, fresh);
				if (!run.files) fresh[suite.dir] = ms;
				if (code === 0) console.log(`  ✓ ${label}  ${fmt(ms)}  (lane ${lane})`);
				else {
					failures.push(`${label}: ${log}`);
					console.log(`  ✗ ${label}  ${fmt(ms)}  (lane ${lane})\n${tail(log)}\n  log: ${log}`);
				}
			}
		})
	);

	writeFileSync(TIMINGS, JSON.stringify({ ...timings, ...fresh }, null, '\t') + '\n');
	console.log(
		`\n${failures.length ? '✗' : '✓'} ${totals.passed} passed, ${totals.failed} failed, ` +
			`${totals.flaky} flaky, ${totals.skipped} skipped in ${fmt(Date.now() - started)}`
	);
	for (const f of failures) console.log(`  ✗ ${f}`);
	process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
	kill_all();
	console.error(e);
	process.exit(1);
});
