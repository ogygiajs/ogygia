/**
 * THE STANDARD SWEEP: the runs that decide the steps ledger's `reached` bucket (src/steps.ts). Its
 * targets are the ledger's `sweep`: the palaestra, then each generated app (written from its seed,
 * its peer built when it draws one, both builds made), each run for its seeds from 1, and the
 * ledger's saved plans, each replayed on its app (a step only a lucky seed reached, made the same
 * run every time; it fails when its plan no longer reaches what it names). Each target's
 * results.json is kept, and every step is then accounted for against what they reached together.
 *
 *   node --experimental-vm-modules src/sweep.ts [--out <dir>] [--jobs 4] [--write]
 *
 * Fails (exit code 1) when a step is in no bucket, a `reached` step was not reached, or a `dead`
 * one was. `--write` sets `reached` to what the sweep reached. Runs under `nice`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { all_steps, universe } from './coverage.ts';
import { account, LEDGER, read_ledger, reached_in } from './steps.ts';

const SIM = resolve(import.meta.dirname, '..');
const ROOT = resolve(SIM, '..', '..');

function arg(flag: string): string | undefined {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
}

/** Runs `cmd` in `cwd`, its output to `log`; whether it succeeded. */
function sh(cwd: string, cmd: string, log: string): boolean {
	return (
		spawnSync('/bin/sh', ['-c', `${cmd} >> '${log}' 2>&1`], { cwd, stdio: 'ignore' }).status === 0
	);
}

function main(): void {
	const ledger = read_ledger();
	const out = resolve(arg('--out') ?? join(tmpdir(), 'ogygia-sweep'));
	const jobs = Number(arg('--jobs') ?? 4);
	mkdirSync(out, { recursive: true });
	const log = join(out, 'sweep.log');
	writeFileSync(log, '');
	const sw = ledger.sweep;
	const run = (app: string, runs: number, steps: number, name: string): string | null => {
		const results = join(SIM, 'results.json');
		// (a run with findings exits 1: the sweep counts what it reached either way)
		sh(
			SIM,
			`nice -n 10 node --experimental-vm-modules --no-warnings src/cli.ts --app ${app} --runs ${runs} --from 1 --steps ${steps} --jobs ${jobs} --no-replay`,
			log
		);
		if (!existsSync(results)) return null;
		const kept = join(out, `results-${name}.json`);
		copyFileSync(results, kept);
		return kept;
	};
	const files: string[] = [];
	const failed: string[] = [];
	// (each saved plan of the app just built, replayed: the same run every time)
	const by_plan = new Map<string, Set<string>>();
	const replay = (app: string, of: 'palaestra' | number): void => {
		for (const p of (sw.plans ?? []).filter((x) => x.app === of)) {
			const results = join(SIM, 'results.json');
			sh(
				SIM,
				`nice -n 10 node --experimental-vm-modules --no-warnings src/cli.ts --app ${app} --plan '${join(ROOT, p.plan)}' --no-replay`,
				log
			);
			if (!existsSync(results)) {
				failed.push(`${p.plan}: no results`);
				continue;
			}
			const kept = join(out, `results-${p.plan.replace(/\W+/g, '-')}.json`);
			copyFileSync(results, kept);
			files.push(kept);
			by_plan.set(p.plan, new Set(reached_in(kept)));
		}
	};
	const pal = run('../../apps/palaestra', sw.palaestra.runs, sw.palaestra.steps, 'palaestra');
	if (pal === null) failed.push('palaestra: no results');
	else files.push(pal);
	replay('../../apps/palaestra', 'palaestra');
	// (an app a plan runs on is built though no seeds run on it)
	const planned = (sw.plans ?? []).flatMap((p) => (p.app === 'palaestra' ? [] : [p.app]));
	for (const g of new Set([...sw.gens, ...planned])) {
		if (!sh(SIM, `node --no-warnings src/gen.ts --seed ${g}`, log)) {
			failed.push(`gen ${g}: not written`);
			continue;
		}
		const plan = JSON.parse(readFileSync(join(ROOT, 'apps/sim-gen/src/lib/gen/plan.json'), 'utf8'));
		if (
			plan.peer &&
			!sh(join(ROOT, 'apps/sim-gen-peer'), 'OGYGIA_RULES=1 nice -n 10 pnpm exec vite build', log)
		) {
			failed.push(`gen ${g}: its peer did not build`);
			continue;
		}
		if (!sh(SIM, 'nice -n 10 node --no-warnings src/builds.ts --app ../../apps/sim-gen', log)) {
			failed.push(`gen ${g}: did not build`);
			continue;
		}
		if (sw.gens.includes(g)) {
			const r = run('../../apps/sim-gen', sw.runs, sw.steps, `gen${g}`);
			if (r === null) failed.push(`gen ${g}: no results`);
			else files.push(r);
			console.log(`gen ${g}: ${r === null ? 'no results' : 'done'}`);
		}
		replay('../../apps/sim-gen', g);
	}
	const reached = new Set(files.flatMap(reached_in));
	const all = all_steps(universe(ROOT));
	const a = account(all, ledger, {
		read: (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null),
		sweep: reached,
		plans: by_plan
	});
	if (process.argv.includes('--write')) {
		const r = [...all].filter((s) => reached.has(s)).sort();
		const covered = ledger.covered.filter((c) => !reached.has(c.step));
		writeFileSync(LEDGER, JSON.stringify({ ...ledger, reached: r, covered }, null, '\t') + '\n');
		console.log(`wrote ${LEDGER}: ${r.length} reached`);
	}
	const summary = {
		accounted: a.accounted,
		total: a.total,
		reached: [...all].filter((s) => reached.has(s)).length,
		covered: ledger.covered.length,
		dead: ledger.dead.length,
		failures: [...failed, ...a.failures],
		newly_reached: a.newly_reached,
		unaccounted: [...all].filter(
			(s) =>
				!reached.has(s) &&
				!ledger.covered.some((c) => c.step === s) &&
				!ledger.dead.some((d) => d.step === s)
		)
	};
	writeFileSync(join(out, 'steps.json'), JSON.stringify(summary, null, '\t') + '\n');
	console.log(
		`steps accounted: ${a.accounted}/${a.total} (sweep reached ${summary.reached}, covered ${summary.covered}, dead ${summary.dead})`
	);
	for (const s of a.newly_reached) console.log(`  now reached (move it to reached: --write): ${s}`);
	for (const f of summary.failures) console.log(`  ${f}`);
	if (summary.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === import.meta.filename) main();
