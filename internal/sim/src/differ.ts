/**
 * THE DIFFERENTIAL: the same calm runs in the simulator's fake browser (happy-dom) and in real ones
 * (Chromium, Firefox, WebKit, through the real-browser player), and what ogygia observably did, put
 * side by side after every action: the document at rest, the lifecycle and ogygia events each
 * document heard, the machine steps it took, the requests it made, and what it said. A difference
 * is a gap in the fake browser (fixed in the simulator, test first) or a bug the fake browser hid
 * (filed). internal/notes/dst.md "The differential".
 *
 *   node --experimental-vm-modules src/differ.ts [--app <dir>] [--from 1] [--runs 10] [--steps 8]
 *     [--browsers chromium,firefox,webkit] [--out <dir>] [--jobs 4]
 *   node src/differ.ts --compare <dir>         # only compare what a run left in <dir>
 *
 * A calm run (`cli.ts --calm`) is one both sides can play alike: no fault, no buggify point, one
 * server, one build, no deploy and no offline. The simulator plays each seed first and writes its
 * plan with what it saw (`<app>-<seed>.sim.json`); each browser then plays that plan
 * (`SIM_OBSERVE`), one browser at a time. A difference every browser shows alike is the fake
 * browser's (`sim-only`); one where the browsers disagree among themselves is `engines` (an
 * engine's own way, or timing), told apart so a batch's report leads with what is the simulator's.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Observed, Seen, TabSeen } from '@ogygia/tooling/e2e/sim-observe.ts';

/** One way the simulator's run and a browser's differ. */
export interface Difference {
	/** What differs: `url`, `dom`, `heard`, `steps`, `rest`, `requests`, `said`. */
	readonly kind: string;
	/** The difference, run-specific numbers and hashes out: the same gap reads the same in every
	 *  run, so a batch counts it once. */
	readonly what: string;
	/** Where: `<plan> after <action>, tab <n>`. */
	readonly where: string;
	/** A few lines of what each side showed. */
	readonly detail: string;
}

/** A content hash in a file name or a module id, the origin, and a hole's expiry and signature
 *  (from its server's clock: the simulator's starts at its own epoch): none is the run's behavior,
 *  all differ between the two worlds' builds and servers. */
export function plain(s: string): string {
	return s
		.replace(/(https?:\/\/)?(app\.test|localhost:\d+|127\.0\.0\.1:\d+)/g, '<origin>')
		.replace(/\b[A-Za-z0-9_-]{8}\.(js|css)\b/g, '<h>.$1')
		.replace(/\.[0-9a-f]{12}\b/g, '.<id>')
		.replace(/([?&](amp;)?exp=)\d+/g, '$1<exp>')
		.replace(/([?&](amp;)?sig=)[0-9a-f]{16,}/g, '$1<sig>');
}

/** Steps each machine took (name less its `#n`: two engines number instances in the order they
 *  first move, which the network decides), and how many of each ended in each state. */
export function steps_of(moves: string): { steps: Set<string>; rest: Map<string, number> } {
	const steps = new Set<string>();
	const last = new Map<string, string>();
	for (const line of moves.split('\n')) {
		const m = /^([^#\s]+)#(\d+) (\S+) -> (\S+)$/.exec(line);
		if (m === null) continue;
		steps.add(`${m[1]} ${m[3]} -> ${m[4]}`);
		last.set(`${m[1]}#${m[2]}`, `${m[1]} ${m[4]}`);
	}
	const rest = new Map<string, number>();
	for (const s of last.values()) rest.set(s, (rest.get(s) ?? 0) + 1);
	return { steps, rest };
}

/** Lines of `a` not in `b`, counted (a multiset difference). */
function minus(a: readonly string[], b: readonly string[]): string[] {
	const left = new Map<string, number>();
	for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
	const out: string[] = [];
	for (const x of a) {
		const n = left.get(x) ?? 0;
		if (n > 0) left.set(x, n - 1);
		else out.push(x);
	}
	return out;
}

/** The first hunk where two documents differ, a few lines each side; '' when equal. */
export function first_hunk(a: string, b: string): string {
	const x = a.split('\n');
	const y = b.split('\n');
	let i = 0;
	while (i < x.length && i < y.length && x[i] === y[i]) i++;
	if (i === x.length && i === y.length) return '';
	let j = 0;
	while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
	const show = (l: string[]) =>
		l
			.slice(i, Math.min(l.length - j, i + 6))
			.map((s) => `    ${s.slice(0, 160)}`)
			.join('\n');
	return `  sim:
${show(x)}
  real:
${show(y)}`;
}

/** The lifecycle a document heard, as order matters: everything but a region's own events (their
 *  order is the network's), which are compared as a count. A tab's `about:blank` is left out (a
 *  real browser runs init scripts in it, the simulator has no document there to hear). */
function lifecycle(heard: readonly string[]): { order: string[]; regions: string[] } {
	const order: string[] = [];
	const regions: string[] = [];
	let blank = false;
	for (const h of heard) {
		if (h.startsWith('@doc ')) blank = h === '@doc blank';
		if (blank) continue;
		const line = plain(h);
		if (/^ogygia:(hydrated|live|region) /.test(line)) regions.push(line);
		else order.push(line);
	}
	return { order, regions };
}

/** Every way the browser's look at a tab differs from the simulator's. */
function tab_differences(where: string, sim: TabSeen, real: TabSeen): Difference[] {
	const out: Difference[] = [];
	const add = (kind: string, what: string, detail = '') => out.push({ kind, what, where, detail });
	const url = (u: string) => plain(u).replace('<origin>', '');
	if (url(sim.url) !== url(real.url))
		add('url', 'the tab shows another address', `  sim: ${url(sim.url)}\n  real: ${url(real.url)}`);
	else if (real.dom !== '') {
		const hunk = first_hunk(plain(sim.dom), plain(real.dom));
		if (hunk !== '') {
			// (what differs, its first line each side, numbers out: the same gap in another run)
			const head = hunk
				.split('\n')
				.filter((l) => l.startsWith('    '))
				.slice(0, 1)
				.join(' ')
				.trim()
				.replace(/\d+/g, '#');
			add('dom', `the document differs at ${head.slice(0, 80)}`, hunk);
		}
	}
	const a = lifecycle(sim.heard);
	const b = lifecycle(real.heard);
	if (a.order.join('|') !== b.order.join('|'))
		for (const [side, x, y] of [
			['only the simulator', a.order, b.order],
			['only the browser', b.order, a.order]
		] as const)
			for (const h of new Set(minus(x, y)))
				add(
					'heard',
					`${side} heard ${h}`,
					`  sim: ${a.order.join(' | ')}\n  real: ${b.order.join(' | ')}`
				);
	// (an order that differs with the same events: only the first such, as a whole)
	if (
		a.order.join('|') !== b.order.join('|') &&
		minus(a.order, b.order).length === 0 &&
		minus(b.order, a.order).length === 0
	)
		add(
			'heard',
			'the lifecycle came in another order',
			`  sim: ${a.order.join(' | ')}\n  real: ${b.order.join(' | ')}`
		);
	for (const [side, x, y] of [
		['only the simulator', a.regions, b.regions],
		['only the browser', b.regions, a.regions]
	] as const)
		for (const h of new Set(minus(x, y))) add('heard', `${side} heard ${h}`);
	const sm = steps_of(sim.moves);
	const rm = steps_of(real.moves);
	// (the move log keeps its last 500 lines: a step only one side's window still holds is no
	// difference, so steps are compared only when neither side let lines go)
	if (!/earlier moves let go/.test(sim.moves + real.moves)) {
		for (const s of sm.steps) if (!rm.steps.has(s)) add('steps', `only the simulator took ${s}`);
		for (const s of rm.steps) if (!sm.steps.has(s)) add('steps', `only the browser took ${s}`);
	}
	const rest = new Set([...sm.rest.keys(), ...rm.rest.keys()]);
	for (const r of rest)
		if (r.endsWith('ing') && (sm.rest.get(r) ?? 0) !== (rm.rest.get(r) ?? 0))
			add(
				'rest',
				`a machine left in ${r}: sim ${sm.rest.get(r) ?? 0}, real ${rm.rest.get(r) ?? 0}`
			);
	const said = (l: readonly string[]) =>
		l.map((s) =>
			plain(s)
				.replace(/^(error|unhandled): (Uncaught )?/, 'error: ')
				.replace(/\d+/g, '#')
		);
	for (const s of new Set(minus(said(sim.said), said(real.said))))
		add('said', `only the simulator said ${s.slice(0, 120)}`);
	for (const s of new Set(minus(said(real.said), said(sim.said))))
		add('said', `only the browser said ${s.slice(0, 120)}`);
	return out;
}

/** What a browser's run shows differently from the simulator's, look by look. */
export function differences(name: string, sim: Observed, real: Observed): Difference[] {
	const out: Difference[] = [];
	const n = Math.min(sim.seen.length, real.seen.length);
	if (sim.seen.length !== real.seen.length)
		out.push({
			kind: 'run',
			what: 'the runs looked a different number of times',
			where: name,
			detail: `  sim: ${sim.seen.length}, real: ${real.seen.length}`
		});
	for (let i = 0; i < n; i++) {
		const a: Seen = sim.seen[i];
		const b: Seen = real.seen[i];
		const where = `${name} after ${a.after}`;
		for (let t = 0; t < Math.min(a.tabs.length, b.tabs.length); t++)
			out.push(...tab_differences(`${where}, tab ${t}`, a.tabs[t], b.tabs[t]));
		// (a request is the same by tab, method and path, its file's hash out)
		const ra = a.requests.map(plain);
		const rb = b.requests.map(plain);
		const only = (x: string[], y: string[]) => [...new Set(minus(x, y))];
		for (const r of only(ra, rb))
			out.push({
				kind: 'requests',
				what: `only the simulator asked for ${r.replace(/^\d+ /, '')}`,
				where,
				detail: `  ${minus(ra, rb).filter((x) => x === r).length} more time(s)`
			});
		for (const r of only(rb, ra))
			out.push({
				kind: 'requests',
				what: `only the browser asked for ${r.replace(/^\d+ /, '')}`,
				where,
				detail: `  ${minus(rb, ra).filter((x) => x === r).length} more time(s)`
			});
	}
	return out;
}

/** A batch's differences by `kind: what`, each with the browsers that showed it and where. */
export interface Finding {
	readonly key: string;
	readonly browsers: Set<string>;
	readonly where: string[];
	readonly detail: string;
}

/** Compares every simulator run in `dir` with each browser's run of its plan. */
export function compare(dir: string): { findings: Finding[]; browsers: string[]; plans: number } {
	const files = readdirSync(dir);
	const sims = files.filter((f) => f.endsWith('.sim.json'));
	const browsers = new Set<string>();
	const found = new Map<string, Finding>();
	let plans = 0;
	for (const f of sims) {
		const sim = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Observed;
		const base = f.replace(/\.json$/, '');
		const reals = files.filter((g) => g.startsWith(`${base}.`) && g !== f);
		if (reals.length > 0) plans++;
		for (const g of reals) {
			const real = JSON.parse(readFileSync(join(dir, g), 'utf8')) as Observed;
			browsers.add(real.by);
			for (const d of differences(base.replace(/\.sim$/, ''), sim, real)) {
				const key = `${d.kind}: ${d.what}`;
				const at = found.get(key) ?? { key, browsers: new Set(), where: [], detail: d.detail };
				at.browsers.add(real.by);
				if (!at.where.includes(d.where)) at.where.push(d.where);
				found.set(key, at);
			}
		}
	}
	return { findings: [...found.values()], browsers: [...browsers].sort(), plans };
}

/** The report: what every browser showed alike first (the simulator's own gaps), then the rest. */
export function report(c: ReturnType<typeof compare>): string {
	const all = c.findings.filter((f) => f.browsers.size === c.browsers.length);
	const some = c.findings.filter((f) => f.browsers.size < c.browsers.length);
	const by_count = (a: Finding, b: Finding) => b.where.length - a.where.length;
	const line = (f: Finding) =>
		`- ${f.key} (${f.where.length} look(s); ${[...f.browsers].join(', ')}; first: ${f.where[0]})`;
	return [
		`# The differential: ${c.plans} plan(s), browsers ${c.browsers.join(', ') || 'none'}`,
		'',
		`## sim-only (${all.length}): every browser differs from the simulator alike`,
		...all.sort(by_count).map(line),
		'',
		`## engines (${some.length}): some browsers only (an engine's own way, or timing)`,
		...some.sort(by_count).map(line),
		''
	].join('\n');
}

const arg = (flag: string): string | undefined => {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
};

function main(): void {
	/** What made the run check nothing (it fails), and what made it check less (said first). */
	const failed: string[] = [];
	const notes: string[] = [];
	const compare_only = arg('--compare');
	const out = resolve(compare_only ?? arg('--out') ?? join(tmpdir(), 'ogygia-differ'));
	if (compare_only === undefined) {
		const sim = resolve(import.meta.dirname, '..');
		const app = resolve(arg('--app') ?? join(sim, '..', '..', 'apps', 'palaestra'));
		const from = Number(arg('--from') ?? 1);
		const runs = Number(arg('--runs') ?? 10);
		const steps = Number(arg('--steps') ?? 8);
		const jobs = Number(arg('--jobs') ?? 4);
		const browsers = (arg('--browsers') ?? 'chromium').split(',').filter(Boolean);
		mkdirSync(out, { recursive: true });
		const log = join(out, 'differ.log');
		const sh = (cwd: string, cmd: string, env: Record<string, string> = {}): boolean =>
			spawnSync('/bin/sh', ['-c', `${cmd} >> '${log}' 2>&1`], {
				cwd,
				stdio: 'ignore',
				env: { ...process.env, ...env }
			}).status === 0;
		// (`--reuse`: the simulator's runs already in `--out`, played in more browsers)
		if (!process.argv.includes('--reuse')) {
			console.log(`[differ] the simulator: ${runs} calm seeds from ${from}, ${steps} actions`);
			// (a seed's finding exits non-zero too: what was written is what counts, below)
			if (
				!sh(
					sim,
					`nice -n 10 node --experimental-vm-modules --no-warnings src/cli.ts --app '${app}' --from ${from} --runs ${runs} --steps ${steps} --calm --no-replay --jobs ${jobs} --observe '${out}'`
				)
			)
				notes.push('the simulator exited non-zero (a finding, or a crash: differ.log)');
		}
		const plans = readdirSync(out)
			.filter((f) => f.startsWith(`${basename(app)}-`) && f.endsWith('.sim.json'))
			.map((f) => join(out, f));
		// A RUN THAT CHECKED NOTHING FAILS: no plan, or a browser that played none of them, is a
		// broken differential, never a clean report
		if (plans.length === 0) failed.push(`the simulator wrote no plan (differ.log)`);
		// (a generated app's spec serves its own rules build; the palaestra's the one on disk)
		const generated = existsSync(join(app, 'src', 'lib', 'gen', 'plan.json'));
		for (const b of browsers) {
			console.log(`[differ] ${b}: ${plans.length} plans`);
			const ok = sh(
				app,
				`nice -n 10 npx playwright test ${generated ? '' : 'e2e/sim-replay '}--project ${b} --workers 1 --reporter line`,
				{
					SIM_PLANS: plans.join(','),
					SIM_OBSERVE: out,
					E2E_NO_BUILD: '1',
					OGYGIA_SECRET: 'sim-secret',
					PORT: String(arg('--port') ?? 3151)
				}
			);
			const played = plans.filter((p) => existsSync(p.replace(/\.json$/, `.${b}.json`))).length;
			if (played === 0 && plans.length > 0)
				failed.push(`${b} played none of the plans (differ.log)`);
			else if (played < plans.length)
				notes.push(`${b} played ${played} of ${plans.length} plans (differ.log)`);
			if (!ok) notes.push(`${b}: the player's own checks failed on a plan (differ.log)`);
		}
	}
	const c = compare(out);
	const text = [
		...failed.map((f) => `**BROKEN: ${f}**`),
		...notes.map((n) => `> ${n}`),
		report(c)
	].join('\n');
	writeFileSync(join(out, 'differ.md'), text);
	writeFileSync(
		join(out, 'differ.json'),
		`${JSON.stringify(
			c.findings.map((f) => ({ ...f, browsers: [...f.browsers] })),
			null,
			'\t'
		)}\n`
	);
	console.log(text);
	console.log(`[differ] report: ${join(out, 'differ.md')}`);
	if (failed.length > 0) process.exit(1);
}

if (import.meta.main) main();
