/**
 * THE TESTS REPORT: every package's unit and browser tests run once (Vitest, with coverage in the
 * Chromium run), the e2e results read from Playwright's JSON files, and the lot written as the data
 * the docs' tests page reads:
 *
 *   <out>/summary.json        the version's totals and each package's (coverage as four numbers)
 *   <out>/<package>.json      each test (its kind, its result per engine, an issue it cites), and
 *                             the package's coverage as four numbers; compact JSON
 *   <out>/../index.json       the versions there are, newest first (with --index)
 *
 * and, outside the report (CI keeps them as artifacts; never committed):
 *
 *   <raw>/coverage/<package>/ Vitest's coverage-summary.json (per file) and lcov.info, as they came
 *   <raw>/coverage-summary.json  package → lines / branches / functions / statements %
 *
 *   node .github/scripts/test-report.ts --out apps/docs/static/tests/0.13.1 --index \
 *     [--raw <dir>] [--engines chromium,firefox,webkit] [--e2e <dir of Playwright JSON>] \
 *     [--mutation <dir or .jsonl>] [--unmeasured <gate.json>] [--version x] [--commit sha]
 *
 * `--raw` defaults to a fresh directory under the system's temp dir, never the repo.
 *
 * The summary's `robustness` (robustness.ts) is counted from the repository as it is checked out.
 * `--mutation` is a mutation run's output (the dst workflow's `dst-mutation` artifact) and
 * `--unmeasured` the measurement-source gate's gate.json (the heisenbench workflow's artifact);
 * without them, the kills and the measured functions are null.
 *
 *   node .github/scripts/test-report.ts --robustness-only --out <dir>
 *
 * runs no test: it writes `<dir>/robustness.json` (the robustness count and the test-to-source
 * lines, for this commit) to preview the count without a release.
 *
 * Run from the repo root, after `pnpm run build:lib`. A failing test is a result, not an error:
 * the script exits 0 once the files are written, and 1 only when a run could not be read at all.
 */
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collect, type Gate } from './robustness.ts';
import type { CaseLine } from './vitest-results.ts';

const ROOT = resolve(import.meta.dirname, '..', '..');
const REPORTER = join(ROOT, '.github/scripts/vitest-results.ts');

const { values } = parseArgs({
	options: {
		out: { type: 'string' },
		engines: { type: 'string', default: 'chromium' },
		e2e: { type: 'string' },
		version: { type: 'string' },
		commit: { type: 'string' },
		index: { type: 'boolean', default: false },
		'index-only': { type: 'boolean', default: false },
		raw: { type: 'string' },
		packages: { type: 'string' },
		'robustness-only': { type: 'boolean', default: false },
		mutation: { type: 'string' },
		unmeasured: { type: 'string' }
	}
});
if (!values.out) {
	console.error('test-report: --out <dir> is required');
	process.exit(1);
}
const OUT = resolve(values.out);
const RAW = resolve(values.raw ?? join(tmpdir(), `og-test-report-raw-${process.pid}`));
const ENGINES = values.engines!.split(',').filter(Boolean);
const VERSION =
	values.version ??
	(
		JSON.parse(readFileSync(join(ROOT, 'packages/ogygia/package.json'), 'utf8')) as {
			version: string;
		}
	).version;
const COMMIT =
	values.commit ??
	spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

/** `<out>/../index.json` lists `VERSION` (the versions there are, newest first). */
function write_index(): void {
	const index_file = join(dirname(OUT), 'index.json');
	const have = existsSync(index_file)
		? (JSON.parse(readFileSync(index_file, 'utf8')) as { versions: string[] }).versions
		: [];
	const versions = [VERSION, ...have.filter((v) => v !== VERSION)].sort((a, b) =>
		b.localeCompare(a, undefined, { numeric: true })
	);
	mkdirSync(dirname(index_file), { recursive: true });
	writeFileSync(index_file, `${JSON.stringify({ versions }, null, '\t')}\n`);
}
// (the release workflow writes the report at the released commit, then lists it on main's index)
if (values['index-only']) {
	write_index();
	process.exit(0);
}

type Kind = 'unit' | 'browser' | 'e2e' | 'types' | 'rules';
type Where = 'node' | 'chromium' | 'firefox' | 'webkit';
const WHERE: readonly Where[] = ['node', 'chromium', 'firefox', 'webkit'];
type Result = 'pass' | 'fail' | 'skip';
interface Test {
	file: string;
	name: string;
	kind: Kind;
	results: Partial<Record<Where, Result>>;
	issue?: number;
}
interface Pct {
	lines: number;
	branches: number;
	functions: number;
	statements: number;
}

// ── the packages: each one with a Vitest config ──
const packages = readdirSync(join(ROOT, 'packages'))
	.filter((p) => existsSync(join(ROOT, 'packages', p, 'vitest.config.ts')))
	.filter((p) => !values.packages || values.packages.split(',').includes(p))
	.sort();

/** The package's npm name (`@ogygia/core`), what the report keys it by. */
function npm_name(dir: string): string {
	return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string }).name;
}

/** One Vitest run of `dir`, its cases appended to `cases`. A run with failing tests still counts. */
function vitest(dir: string, cases: string, env: Record<string, string>, args: string[]): void {
	const r = spawnSync(
		'pnpm',
		['exec', 'vitest', 'run', '--reporter=dot', `--reporter=${REPORTER}`, ...args],
		{
			cwd: dir,
			env: { ...process.env, ...env, OGYGIA_TEST_RESULTS: cases, NO_COLOR: '1' },
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024
		}
	);
	const said = `${r.stdout ?? ''}${r.stderr ?? ''}`;
	// (a package with no browser project has nothing for `--project browser*` to match)
	if (r.status !== 0 && /No projects matched/i.test(said)) return;
	if (r.status !== 0)
		console.log(`  ${basename(dir)}: vitest exited ${r.status} (failures are in the report)`);
}

const where_of = (project: string): Where | null => {
	if (!project.startsWith('browser')) return 'node';
	for (const e of ['chromium', 'firefox', 'webkit'] as const) if (project.includes(e)) return e;
	return null;
};
const kind_of = (project: string, file: string): Kind => {
	if (file.endsWith('.test-d.ts') || /typecheck|types?$/i.test(project)) return 'types';
	if (/(^|\/)rules?[-./]/.test(basename(file)) || /\/rules\//.test(file)) return 'rules';
	return project.startsWith('browser') ? 'browser' : 'unit';
};
const result_of = (state: string): Result =>
	state === 'passed' || state === 'expected' || state === 'flaky'
		? 'pass'
		: state === 'failed' || state === 'unexpected' || state === 'timedOut'
			? 'fail'
			: 'skip';
const ISSUE_RE = /(?:^|[^\w&])#(\d{2,6})\b/;
const issue_of = (name: string): number | undefined => {
	const m = ISSUE_RE.exec(name);
	return m ? Number(m[1]) : undefined;
};

/** Every test of a package, by file and name. */
function add(tests: Map<string, Test>, t: Omit<Test, 'results'>, where: Where, result: Result) {
	const key = `${t.kind}\u0000${t.file}\u0000${t.name}`;
	let seen = tests.get(key);
	if (!seen) {
		seen = { ...t, results: {} };
		const issue = issue_of(t.name);
		if (issue !== undefined) seen.issue = issue;
		tests.set(key, seen);
	}
	// (a test run twice in one place keeps its worst result)
	const was = seen.results[where];
	if (was !== 'fail') seen.results[where] = was === 'pass' && result === 'skip' ? 'pass' : result;
}

/** Non-empty lines of the source files under `dir` (types-only `.d.ts` left out). */
function lines_in(dir: string, test: (f: string) => boolean): number {
	if (!existsSync(dir)) return 0;
	let n = 0;
	const walk = (d: string) => {
		for (const name of readdirSync(d)) {
			if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (test(p))
				n += readFileSync(p, 'utf8')
					.split('\n')
					.filter((l) => l.trim() !== '').length;
		}
	};
	walk(dir);
	return n;
}
const SOURCE_RE = /\.(ts|js|svelte|mjs)$/;
/** A test file: Vitest's `*.test.ts` (and `*.test-d.ts`), Playwright's `*.spec.ts`. */
const TEST_FILE_RE = /\.(test|test-d|spec)\.ts$/;
/** Fixture code, which tests use but are not: a fixture app or a fixtures folder. */
const FIXTURE_RE = /\/(fixtures?|app|_stubs)\//;
/** Test code: the test files, and the helpers beside them in a test or e2e folder (no fixtures,
 *  fixture apps or stubs, no benches). */
const test_file = (f: string) =>
	(TEST_FILE_RE.test(f) ||
		(/\/(test|e2e)\//.test(f) && f.endsWith('.ts') && !f.endsWith('.d.ts'))) &&
	!FIXTURE_RE.test(f) &&
	!/\/bench\//.test(f);
/** What `ratio` divides, said on the page. */
const RATIO_DEFINITION =
	'non-blank lines of test code across the repo (*.test.ts, *.test-d.ts, *.spec.ts, and the .ts helpers in test/ and e2e/ folders; no fixtures, fixture apps, stubs or benches), over non-blank lines of packages/*/src (no .d.ts or generated files)';
const is_source = (f: string) => SOURCE_RE.test(f) && !f.endsWith('.d.ts');

/** The files that use fast-check (seeded property and simulation tests). */
const SEEDED_RE =
	/from ['"](?:fast-check|@ogygia\/config\/sim)['"]|\bfc\.(?:assert|property|scheduler)\b/;

/** The cases in each package's bench files. */
function benches_in(dir: string): number {
	const bench = join(dir, 'bench');
	if (!existsSync(bench)) return 0;
	let n = 0;
	for (const f of readdirSync(bench).filter((f) => f.endsWith('.bench.ts')))
		n += (readFileSync(join(bench, f), 'utf8').match(/\bbench\(/g) ?? []).length;
	return n;
}

// ── e2e: Playwright's JSON reports, mapped to the package whose suite they ran ──
interface PwSuite {
	file?: string;
	specs?: { title: string; file: string; tests: { projectName: string; status: string }[] }[];
	suites?: PwSuite[];
}
function e2e_reports(dir: string | undefined): { root: string; suites: PwSuite[] }[] {
	if (!dir || !existsSync(dir)) return [];
	const out: { root: string; suites: PwSuite[] }[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (name.endsWith('.json'))
				try {
					const j = JSON.parse(readFileSync(p, 'utf8')) as {
						config?: { rootDir?: string };
						suites?: PwSuite[];
					};
					if (j.suites && j.config?.rootDir) out.push({ root: j.config.rootDir, suites: j.suites });
				} catch {
					// ok: not a Playwright report (another artifact beside it)
				}
		}
	};
	walk(dir);
	return out;
}
/** A Playwright root dir (…/packages/core/e2e, …/apps/palaestra/e2e) to the report's package. */
function e2e_package(root: string): string {
	const m = /(?:^|\/)(packages|apps)\/([^/]+)/.exec(root.replaceAll('\\', '/'));
	if (!m) return basename(root);
	const dir = join(ROOT, m[1], m[2]);
	return existsSync(join(dir, 'package.json')) ? npm_name(dir) : m[2];
}

/** Every `.jsonl` under `path` (a mutation run's artifact), or the file itself. */
function jsonl_texts(path: string): string[] {
	if (!statSync(path).isDirectory()) return [readFileSync(path, 'utf8')];
	return readdirSync(path, { recursive: true, encoding: 'utf8' })
		.filter((f) => f.endsWith('.jsonl'))
		.sort()
		.map((f) => readFileSync(join(path, f), 'utf8'));
}

/** The robustness count of the repository as checked out, with the CI artifacts given. */
function robustness() {
	return collect(ROOT, {
		mutation: values.mutation ? jsonl_texts(resolve(values.mutation)) : [],
		gate: values.unmeasured
			? (JSON.parse(readFileSync(resolve(values.unmeasured), 'utf8')) as Gate)
			: null
	});
}

/** The whole repo's test lines over every package's source lines (what `ratio` divides). */
function repo_lines(): { srcLines: number; testLines: number; ratio: number } {
	const testLines =
		lines_in(join(ROOT, 'packages'), test_file) + lines_in(join(ROOT, 'apps'), test_file);
	const srcLines = readdirSync(join(ROOT, 'packages')).reduce(
		(n, p) => n + lines_in(join(ROOT, 'packages', p, 'src'), is_source),
		0
	);
	return {
		srcLines,
		testLines,
		ratio: srcLines ? Math.round((testLines / srcLines) * 100) / 100 : 0
	};
}

if (values['robustness-only']) {
	const lines = Object.fromEntries(
		packages.map((p) => {
			const dir = join(ROOT, 'packages', p);
			return [
				npm_name(dir),
				{
					srcLines: lines_in(join(dir, 'src'), is_source),
					testLines: lines_in(join(dir, 'test'), test_file) + lines_in(join(dir, 'e2e'), test_file)
				}
			];
		})
	);
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, 'robustness.json'),
		`${JSON.stringify(
			{
				version: VERSION,
				commit: COMMIT,
				date: new Date().toISOString(),
				lines: { ...repo_lines(), ratioDefinition: RATIO_DEFINITION, packages: lines },
				robustness: robustness()
			},
			null,
			'\t'
		)}\n`
	);
	console.log(`robustness ${COMMIT.slice(0, 8)} → ${relative(ROOT, join(OUT, 'robustness.json'))}`);
	process.exit(0);
}

// ── run ──
const tmp = join(tmpdir(), `og-test-report-${process.pid}`);
mkdirSync(tmp, { recursive: true });
mkdirSync(OUT, { recursive: true });
const by_package = new Map<string, Map<string, Test>>();
const coverage = new Map<string, Pct>();
const lines = new Map<
	string,
	{ src: number; test: number; seeded_files: Set<string>; benches: number }
>();
const fails = new Map<string, number>();

for (const p of packages) {
	const dir = join(ROOT, 'packages', p);
	const name = npm_name(dir);
	const cases = join(tmp, `${p}.ndjson`);
	rmSync(cases, { force: true });
	const cov_dir = join(RAW, 'coverage', p);
	console.log(`${name}: node + chromium (coverage)`);
	vitest(dir, cases, { OGYGIA_BROWSERS: 'chromium' }, [
		'--coverage.enabled',
		'--coverage.provider=v8',
		'--coverage.include=src/**',
		'--coverage.exclude=**/*.d.ts',
		'--coverage.exclude=**/dist/**',
		'--coverage.reporter=json-summary',
		'--coverage.reporter=lcov',
		`--coverage.reportsDirectory=${cov_dir}`
	]);
	const others = ENGINES.filter((e) => e !== 'chromium');
	if (others.length) {
		console.log(`${name}: ${others.join(', ')}`);
		vitest(dir, cases, { OGYGIA_BROWSERS: others.join(',') }, ['--project', 'browser*']);
	}
	const tests = new Map<string, Test>();
	if (existsSync(cases))
		for (const line of readFileSync(cases, 'utf8').split('\n')) {
			if (!line) continue;
			const c = JSON.parse(line) as CaseLine;
			const where = where_of(c.project);
			if (!where) continue;
			add(
				tests,
				{ file: relative(ROOT, c.file), name: c.name, kind: kind_of(c.project, c.file) },
				where,
				result_of(c.state)
			);
		}
	by_package.set(name, tests);
	const summary = join(cov_dir, 'coverage-summary.json');
	if (existsSync(summary)) {
		// (the per-file numbers stay in the raw summary: the report keeps the package's four)
		const t = (
			JSON.parse(readFileSync(summary, 'utf8')) as {
				total: Record<'lines' | 'branches' | 'functions' | 'statements', { pct: number }>;
			}
		).total;
		coverage.set(name, {
			lines: t.lines.pct,
			branches: t.branches.pct,
			functions: t.functions.pct,
			statements: t.statements.pct
		});
	}
	const seeded_files = new Set<string>();
	for (const t of tests.values())
		if (!seeded_files.has(t.file) && SEEDED_RE.test(readFileSync(join(ROOT, t.file), 'utf8')))
			seeded_files.add(t.file);
	lines.set(name, {
		src: lines_in(join(dir, 'src'), is_source),
		test: lines_in(join(dir, 'test'), test_file) + lines_in(join(dir, 'e2e'), test_file),
		seeded_files,
		benches: benches_in(dir)
	});
}

for (const { root, suites } of e2e_reports(values.e2e)) {
	const name = e2e_package(root);
	let tests = by_package.get(name);
	if (!tests) by_package.set(name, (tests = new Map()));
	const walk = (s: PwSuite, prefix: string[]) => {
		for (const spec of s.specs ?? [])
			for (const t of spec.tests) {
				const where = (['chromium', 'firefox', 'webkit'] as const).find((e) => e === t.projectName);
				if (!where) continue;
				add(
					tests,
					{
						file: relative(ROOT, join(root, spec.file)),
						name: [...prefix, spec.title].join(' > '),
						kind: 'e2e'
					},
					where,
					result_of(t.status)
				);
			}
		for (const inner of s.suites ?? [])
			walk(inner, inner.file ? prefix : [...prefix, (inner as { title?: string }).title ?? '']);
	};
	for (const s of suites) walk(s, []);
}

// ── write ──
const KINDS: Kind[] = ['unit', 'browser', 'e2e', 'types', 'rules'];
const zero_kinds = () => Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
const zero_engines = () =>
	Object.fromEntries(
		(['chromium', 'firefox', 'webkit'] as const).map((e) => [e, { pass: 0, fail: 0, skip: 0 }])
	) as Record<'chromium' | 'firefox' | 'webkit', Record<Result, number>>;

const totals = {
	tests: 0,
	byKind: zero_kinds(),
	byEngine: zero_engines(),
	regression: 0,
	seeded: 0,
	benches: 0,
	srcLines: 0,
	testLines: 0,
	ratio: 0,
	ratioDefinition: RATIO_DEFINITION,
	coverage: { lines: 0, branches: 0, functions: 0, statements: 0 } as Pct
};
const summary_packages: Record<string, unknown> = {};
const coverage_summary: Record<string, Pct> = {};
let cov_weight = 0;

for (const [name, found] of [...by_package].sort(([a], [b]) => a.localeCompare(b))) {
	const list = [...found.values()].sort(
		(a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name)
	);
	const by_kind = zero_kinds();
	let fail = 0;
	for (const t of list) {
		by_kind[t.kind]++;
		if (t.issue !== undefined) totals.regression++;
		if (lines.get(name)?.seeded_files.has(t.file)) totals.seeded++;
		for (const [where, r] of Object.entries(t.results) as [Where, Result][]) {
			if (r === 'fail') fail++;
			if (where !== 'node') totals.byEngine[where][r]++;
		}
	}
	const l = lines.get(name) ?? { src: 0, test: 0, seeded_files: new Set(), benches: 0 };
	const cov = coverage.get(name);
	totals.tests += list.length;
	for (const k of KINDS) totals.byKind[k] += by_kind[k];
	totals.benches += l.benches;
	if (cov) {
		coverage_summary[name] = cov;
		// (the version's coverage: each package's, weighed by its source lines)
		for (const k of ['lines', 'branches', 'functions', 'statements'] as const)
			totals.coverage[k] += cov[k] * l.src;
		cov_weight += l.src;
	}
	fails.set(name, fail);
	summary_packages[name] = {
		tests: list.length,
		byKind: by_kind,
		coverage: cov ?? null,
		srcLines: l.src,
		testLines: l.test,
		fail
	};
	// compact: each file named once; a test is [file index, name, kind, results, issue?], its
	// results one letter per place in `where` (p pass, f fail, s skip, - not run there)
	const files = [...new Set(list.map((t) => t.file))];
	const index = new Map(files.map((f, i) => [f, i]));
	const tests = list.map((t) => {
		const results = WHERE.map((w) => (t.results[w] ? t.results[w][0] : '-')).join('');
		const row: (string | number)[] = [index.get(t.file)!, t.name, t.kind, results];
		if (t.issue !== undefined) row.push(t.issue);
		return row;
	});
	writeFileSync(
		join(OUT, `${name.replace(/^@/, '').replaceAll('/', '-')}.json`),
		`${JSON.stringify({ format: 1, where: WHERE, files, tests, coverage: cov ?? null })}\n`
	);
}
for (const k of ['lines', 'branches', 'functions', 'statements'] as const)
	totals.coverage[k] = cov_weight ? Math.round((totals.coverage[k] / cov_weight) * 100) / 100 : 0;
// (the version's test lines are the whole repo's: an app's e2e suite tests the packages too; its
// source lines every package's, tested by Vitest here or not)
Object.assign(totals, repo_lines());

writeFileSync(
	join(OUT, 'summary.json'),
	`${JSON.stringify(
		{
			version: VERSION,
			commit: COMMIT,
			date: new Date().toISOString(),
			engines: ENGINES,
			e2e: values.e2e ? true : false,
			totals,
			packages: summary_packages,
			robustness: robustness()
		},
		null,
		'\t'
	)}\n`
);
mkdirSync(RAW, { recursive: true });
writeFileSync(
	join(RAW, 'coverage-summary.json'),
	`${JSON.stringify(coverage_summary, null, '\t')}\n`
);

if (values.index) write_index();
rmSync(tmp, { recursive: true, force: true });
console.log(
	`tests report ${VERSION}: ${totals.tests} tests, ${[...fails.values()].reduce((a, b) => a + b, 0)} failing results, coverage ${totals.coverage.lines}% lines → ${relative(ROOT, OUT)}`
);
