/**
 * The measurement-source gate: `node internal/heisenbench/src/unmeasured.ts [--base <rev>] [--out dir]`
 * (or `pnpm bench:unmeasured`).
 *
 * Every function in packages/<pkg>/src should have something that measures it: a bench file that
 * runs it (packages/<pkg>/bench), or a unit test that calls it with inputs Heisenbench can replay. This
 * lists the functions that have neither and, with `--base`, fails on the NEW ones only: functions
 * the base commit does not have. Functions that were unmeasured before are listed, not failed.
 *
 *   1. count every bench file (Heisenbench `run`): the functions a bench runs
 *   2. list every function of packages/<pkg>/src (Heisenbench `inventory`), and the ones no bench ran
 *   3. run each package's node tests with the input recorder on (record.ts) for those functions
 *   4. replay the recorded inputs (Heisenbench `replay`): the output must come back the same
 *   5. the base commit's functions (its packages/<pkg>/src, from git), and the gate
 *      (Heisenbench `unmeasured`), with the exemptions in internal/heisenbench/unmeasured.json
 *
 * An exemption is `{ "id": "packages/core/src/x.ts > fn", "reason": "why nothing can measure it" }`.
 * One whose id names no function any more fails the gate too (./stale.ts).
 *
 * `--ids-only` (seconds, run it before sending a PR): steps 2 and 5's inventories only, no bench, test
 * or replay. Fails on stale exemptions; with `--base`, lists the new functions no exemption names
 * (each needs a bench, a replayable unit test or an exemption, or the full gate fails on it).
 * Writes to --out (default .heisenbench/unmeasured): gate.md (also the job summary in CI), gate.json
 * (every function with its sources), and what each step produced. Exit 1 when the gate fails.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { heisenbench_dir, bench_packages, link_heisenbench, REPO_ROOT } from './heisenbench.ts';
import { gone_exemptions, unexempted_new_functions, type Exemption } from './stale.ts';
import { read_ledger_file } from '../../sim/src/ledger-json.ts';

const { values } = parseArgs({
	options: {
		base: { type: 'string' },
		out: { type: 'string' },
		'no-record': { type: 'boolean' },
		'ids-only': { type: 'boolean' }
	}
});
const ids_only = values['ids-only'] === true;

const PRELOAD = fileURLToPath(new URL('./preload.ts', import.meta.url));
const EXEMPT = fileURLToPath(new URL('../unmeasured.json', import.meta.url));
const SOURCE_EXT = ['.ts', '.js', '.mts', '.mjs'];

const out = join(REPO_ROOT, values.out ?? '.heisenbench/unmeasured');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const log = (line: string) => console.log(`[unmeasured] ${line}`);

const heisenbench = heisenbench_dir();
link_heisenbench(heisenbench);
const CLI = join(heisenbench, 'src', 'cli.ts');
const node_options = `${process.env.NODE_OPTIONS ?? ''} --import=${PRELOAD}`.trim();

function heisenbench_cli(args: string[], o: { preload?: boolean } = {}): number {
	const r = spawnSync(process.execPath, ['--no-warnings', CLI, ...args], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
		env: o.preload ? { ...process.env, NODE_OPTIONS: node_options } : process.env
	});
	return r.status ?? 1;
}

/** Source files of the packages (packages/<pkg>/src), relative to `root`, from git at `rev`. */
function source_files(rev: string | null): string[] {
	const args = rev
		? ['ls-tree', '-r', '--name-only', rev, '--', 'packages']
		: ['ls-files', '--', 'packages'];
	return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
		.split('\n')
		.filter(
			(f) =>
				/^packages\/[^/]+\/src\//.test(f) &&
				SOURCE_EXT.some((e) => f.endsWith(e)) &&
				!f.endsWith('.d.ts')
		)
		.sort();
}

/** The package source files git sees as renamed from `rev` to the working tree: old path → new. */
function renames(rev: string): Map<string, string> {
	const out = execFileSync(
		'git',
		['diff', '--name-status', '--find-renames', '--diff-filter=R', rev, '--', 'packages'],
		{ cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }
	);
	const moved = new Map<string, string>();
	for (const line of out.split('\n')) {
		const [status, from, to] = line.split('\t');
		if (status?.startsWith('R') && from && to) moved.set(from, to);
	}
	return moved;
}

/** Heisenbench `inventory` of the package sources at `rev`, read where they sit now (a file git
 *  sees as moved since `rev` is read at its new path, so a move is not a crop of new functions). */
function base_inventory_of(rev: string): string {
	const base_root = mkdtempSync(join(tmpdir(), 'ogygia-base-'));
	const files = source_files(rev);
	const tar = execFileSync('git', ['archive', '--format=tar', rev, '--', ...files], {
		cwd: REPO_ROOT,
		maxBuffer: 1 << 30
	});
	execFileSync('tar', ['-x', '-C', base_root], { input: tar });
	const moved = renames(rev);
	const base_files = files.map((f) => {
		const to = moved.get(f);
		if (to === undefined) return f;
		mkdirSync(dirname(join(base_root, to)), { recursive: true });
		renameSync(join(base_root, f), join(base_root, to));
		return to;
	});
	const base_list = join(out, 'base-files.txt');
	writeFileSync(base_list, `${base_files.join('\n')}\n`);
	const base_inventory = join(out, 'base-inventory.json');
	heisenbench_cli(['inventory', '--list', base_list, '--root', base_root, '--out', base_inventory]);
	rmSync(base_root, { recursive: true, force: true });
	return base_inventory;
}

// 1. what the bench files run
const reports: string[] = [];
const benches = ids_only ? [] : bench_packages().flatMap((p) => p.files);
benches.forEach((file, i) => {
	const report = join(out, 'bench', `${i}.json`);
	mkdirSync(join(out, 'bench'), { recursive: true });
	const rel = relative(REPO_ROOT, file);
	log(`bench ${rel}`);
	heisenbench_cli(['run', rel, '--root', '.', '--out', report], { preload: true });
	if (existsSync(report)) reports.push(report);
	else log(`  ${rel} produced no report; its functions count as not run by a bench`);
});

// 2. every function, and the ones no bench ran
const list = join(out, 'files.txt');
writeFileSync(list, `${source_files(null).join('\n')}\n`);
const targets = join(out, 'targets.json');
const inventory = join(out, 'inventory.json');
heisenbench_cli([
	'inventory',
	'--list',
	list,
	'--root',
	'.',
	'--out',
	inventory,
	...(ids_only ? [] : ['--reports', reports.join(','), '--targets', targets])
]);

// The exemptions that name no function any more (./stale.ts), matched as the Heisenbench
// checkout's gate matches them
const { context_path } = (await import(
	pathToFileURL(join(heisenbench, 'src', 'identity.ts')).href
)) as { context_path: (id: string) => string };
const exemptions = (read_ledger_file(EXEMPT) as { exempt: Exemption[] }).exempt;
type Inventory = { functions: { id: string }[] };
const read_inventory = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Inventory;
const gone = gone_exemptions(exemptions, read_inventory(inventory), context_path);
const gone_md = gone.length
	? `
**${gone.length} exemption${gone.length === 1 ? '' : 's'} naming no function any more.** Take each out of internal/heisenbench/unmeasured.json (its function was renamed, moved or deleted; a renamed one that is still unmeasured gets an exemption under its new id):

${gone.map((e) => `- \`${e.id}\``).join('\n')}
`
	: '';
for (const e of gone) log(`stale exemption: ${e.id}`);

if (ids_only) {
	const parts = [gone_md || '\nNo stale exemption.\n'];
	if (values.base) {
		const fresh = unexempted_new_functions(
			read_inventory(inventory),
			read_inventory(base_inventory_of(values.base)),
			exemptions,
			context_path
		);
		for (const f of fresh) log(`new, no exemption: ${f.id}`);
		const lines = fresh.length
			? [
					`**${fresh.length} new function${fresh.length === 1 ? '' : 's'} no exemption names.** Each needs a bench, a unit test whose inputs replay, or an exemption, or the full gate fails on it:`,
					'',
					...fresh.map((f) => `- \`${f.id}\``)
				]
			: ['No new function without an exemption.'];
		parts.push(['', ...lines, ''].join('\n'));
	}
	writeFileSync(join(out, 'gate.md'), parts.join(''));
	log(
		`ids only: ${gone.length} stale exemption(s); see ${relative(REPO_ROOT, join(out, 'gate.md'))}`
	);
	process.exit(gone.length ? 1 : 0);
}

// 3. the tests, recording the inputs of those functions
const records = join(out, 'records');
mkdirSync(records, { recursive: true });
if (!values['no-record']) {
	for (const pkg of readdirSync(join(REPO_ROOT, 'packages')).sort()) {
		const dir = join(REPO_ROOT, 'packages', pkg);
		const config = join(dir, 'vitest.config.ts');
		if (!existsSync(config)) continue;
		// node tests only: the browser project's inputs are DOM nodes, not replayable values
		const project = readFileSync(config, 'utf8').includes("name: 'node'")
			? ['--project', 'node']
			: [];
		log(`tests of ${pkg}, recording`);
		const r = spawnSync(
			join(dir, 'node_modules', '.bin', 'vitest'),
			['run', ...project, '--reporter', 'dot'],
			{
				cwd: dir,
				stdio: 'inherit',
				env: { ...process.env, HEISENBENCH_RECORD: targets, HEISENBENCH_RECORD_OUT: records }
			}
		);
		// A failing test still recorded what it ran; the check job is where tests fail a PR.
		if (r.status !== 0) log(`  tests of ${pkg} exited ${r.status} (recorded what ran)`);
	}
}

// 4. replay
const replay = join(out, 'replay.json');
heisenbench_cli(['replay', '--records', records, '--root', '.', '--out', replay], {
	preload: true
});

// 5. the base's functions, then the gate
const gate_args = [
	'unmeasured',
	'--inventory',
	inventory,
	'--reports',
	reports.join(','),
	'--records',
	records,
	'--replay',
	replay,
	'--exempt',
	EXEMPT,
	'--out',
	join(out, 'gate.json'),
	'--md',
	join(out, 'gate.md')
];
const skipped = join(records, 'skipped.txt');
if (existsSync(skipped)) {
	const ids = [...new Set(readFileSync(skipped, 'utf8').split('\n').filter(Boolean))].sort();
	writeFileSync(join(out, 'skipped.json'), `${JSON.stringify(ids)}\n`);
	gate_args.push('--skipped', join(out, 'skipped.json'));
}
if (values.base) gate_args.push('--base-inventory', base_inventory_of(values.base));
let status = heisenbench_cli(gate_args);
if (gone.length) {
	writeFileSync(join(out, 'gate.md'), gone_md, { flag: 'a' });
	status = 1;
}
if (process.env.GITHUB_STEP_SUMMARY) {
	writeFileSync(process.env.GITHUB_STEP_SUMMARY, readFileSync(join(out, 'gate.md')), { flag: 'a' });
}
process.exitCode = status;
