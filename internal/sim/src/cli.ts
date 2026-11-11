/**
 * `pnpm sim`: runs seeds against a built app and reports what broke.
 *
 *   pnpm sim                         # 20 seeds from 1, 12 actions each, palaestra
 *   pnpm sim --seed 7                # one seed (replays it exactly)
 *   pnpm sim --seed 7 --step 4       # ...stopping after action 4, its trace printed
 *   pnpm sim --runs 200 --steps 30   # more
 *   pnpm sim --from 41 --runs 200    # seeds 41 to 240
 *   pnpm sim:long                    # the nightly size
 *   --app <dir>                      # another app (its .svelte-kit/output, built with OGYGIA_RULES=1)
 *   --no-replay                      # skip the replay check (each seed run twice, traces compared)
 *   --jobs N                         # worlds at once, each in its own process (default: cores - 1)
 *
 * Seeds run in a pool of worker processes (each world has its own host, and a worker is replaced
 * after a few dozen runs: a loaded server graph is never freed). A seed's replay runs in another
 * worker than its first run where the pool has two, so state a process keeps between worlds shows
 * as a replay difference too.
 *
 * Each run: a world from the seed (faults: a random subset, the swarm), one visitor, a workload of
 * actions; after each action the page's errors and ogygia's rules; at the end, with every tab back
 * online, MPA equivalence for each tab whose last load was online, and cache isolation.
 *
 * THE REPLAY CHECK: every seed runs twice, and the two traces (every loop task, every action, each
 * tab's URL and DOM hash after it, what broke) must be equal byte for byte. A difference is a
 * nondeterminism leak in the simulator (real async work that moved relative to virtual time), and
 * no finding from that seed is trusted until it is fixed.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
// (the host's real timers: a run replaces the global ones with its simulated ones)
import { clearTimeout as clearRealTimeout, setTimeout as real_timeout } from 'node:timers';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, act, next_action, type Action } from './workload.ts';
import {
	faulted,
	hydrates_as_sent,
	Leaks,
	mpa_equivalent,
	no_cross_visitor_cache,
	no_foreign_html,
	normalize,
	page_errors,
	page_rules,
	stuck,
	uncaught,
	type Broken
} from './oracles.ts';
import { rng } from './rng.ts';
import type { FaultClass } from './network.ts';
import type { Visitor } from './browser.ts';
import { ORIGIN, World } from './world.ts';

const arg = (flag: string): string | undefined => {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
};
const LONG = process.argv.includes('--long');
const REPLAY = !process.argv.includes('--no-replay');
const APP = resolve(
	arg('--app') ?? fileURLToPath(new URL('../../../apps/palaestra', import.meta.url))
);
const OUTPUT = join(APP, '.svelte-kit', 'output');
const FIRST = Number(arg('--seed') ?? arg('--from') ?? 1);
const RUNS = arg('--seed') !== undefined ? 1 : Number(arg('--runs') ?? (LONG ? 500 : 20));
const STEPS = Number(arg('--steps') ?? (LONG ? 40 : 12));
const STOP_AT = arg('--step') === undefined ? Infinity : Number(arg('--step'));

/** Real elapsed ms (the run replaces `performance.now` and `Date` with virtual time). */
const wall = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

/** The app's pages without parameters, from its route tree (groups `(x)` are not in the URL). */
function route_paths(app: string): string[] {
	const out: string[] = [];
	const walk = (dir: string, url: string): void => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (e.isFile() && e.name === '+page.svelte') out.push(url || '/');
			if (!e.isDirectory() || e.name.includes('[')) continue;
			walk(join(dir, e.name), /^\(.*\)$/.test(e.name) ? url : `${url}/${e.name}`);
		}
	};
	walk(join(app, 'src', 'routes'), '');
	return out.sort();
}
const PATHS = route_paths(APP);
/** Paths an app's e2e serves itself (`page.route`), not its build: palaestra's /wake-gate holds a
 *  slow script its spec releases (e2e/wake-gate.spec.ts). */
const SUPPLIED = ['/wake-gate-slow.js'];
const FAULTS: FaultClass[] = ['delay', 'reorder', 'drop', 'duplicate', 'cut', 'tamper', 'redirect'];

/** FNV-1a, hex: a DOM's fingerprint in the trace. */
function fingerprint(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(16).padStart(8, '0');
}

export interface RunResult {
	readonly seed: number;
	readonly faults: FaultClass[];
	readonly actions: Action[];
	readonly broken: Broken[];
	readonly steps: number;
	readonly ms: number;
	/** The full trace: loop tasks, actions, each tab's URL and DOM fingerprint, findings. */
	readonly log: string[];
}

/** One seeded run. */
export async function run(
	seed: number,
	steps = STEPS,
	stop_at = Infinity,
	/** Called once the world is at rest, before the end checks (a found bug's test looks here). */
	at_rest?: (world: World, visitor: Visitor) => Promise<void>
): Promise<RunResult> {
	const r = rng(seed).fork('swarm');
	// swarm testing: each run turns on its own subset of fault classes
	const faults = FAULTS.filter(() => r.chance(0.4));
	// and its own servers: sometimes two instances behind the front door (each request to the
	// seed's pick), their clocks up to 5 s apart
	const instances = r.chance(0.3) ? 2 : 1;
	const skew = instances > 1 && r.chance(0.5) ? 5_000 : 0;
	const world = await World.make({
		seed,
		builds: [{ id: 'v1', output: OUTPUT }],
		faults: new Set(faults),
		// (an action takes up to its 30 s budget, and a run ends at rest after it: room for all)
		horizon: (steps + 2) * 60_000,
		supplied: SUPPLIED,
		instances,
		skew
	});
	running = world;
	world.loop.note(`servers: ${instances}, clocks up to ${skew} ms apart`);
	const actions: Action[] = [];
	const broken: Broken[] = [];
	const dirty = new Set<string>();
	/** The document each tab had when it was last pressed in (by tab name). */
	const pressed = new Map<string, number>();
	const leaks = new Leaks();
	const log = world.loop;
	try {
		const v = world.visitor('visitor');
		const first = world.tab(v);
		await world.go(first, 'goto', '/');
		const wr = world.rng.fork('workload');
		// (the network's exchanges since the last check: a fault among them explains what was said)
		let since = 0;
		for (let i = 0; i < steps && i < stop_at; i++) {
			const a = next_action(wr, v.tabs.length, PATHS);
			actions.push(a);
			log.note(`action ${i + 1}: ${describe(a)}`);
			await act(world, v, a, ORIGIN);
			if (a.kind === 'offline') dirty.add(v.tabs[a.tab % v.tabs.length]?.name ?? '');
			// (a press changes an island's state: the document shows the visitor's own state from then
			// on, kept across client navigations, which no fresh load has; its next document is clean.
			// And it may change the server's (a cart, a counter a command bumps), which every other
			// tab's document predates: seed 221, /cart-b in another tab)
			if (a.kind === 'press') for (const t of v.tabs) pressed.set(t.name, t.documents);
			for (const t of v.tabs) {
				const doc = t.page.mainFrame.document as unknown as Document;
				log.note(`${t.name} ${t.page.mainFrame.url} dom ${fingerprint(normalize(doc))}`);
				for (const line of [...t.errors, ...t.console])
					log.note(`${t.name} said ${line.split('\n')[0]}`);
				const h = t.held();
				log.note(
					`${t.name} holds ${h.listeners} listeners ${h.intervals} intervals ${h.observers} observers`
				);
				for (const b of [
					page_errors(t, world, since),
					hydrates_as_sent(t, world),
					no_foreign_html(t),
					page_rules(t),
					leaks.check(t, pressed.get(t.name) === t.documents)
				])
					// (a known one once: it is told again after every action while the bug stands)
					if (b && !(b.oracle === 'known' && broken.some((k) => k.detail.endsWith(b.detail))))
						broken.push({ ...b, detail: `after ${describe(a)}: ${b.detail}` });
				t.errors.length = 0;
				t.console.length = 0;
			}
			since = world.network.exchanges.length;
			const u = uncaught(world);
			if (u) broken.push({ ...u, detail: `after ${describe(a)}: ${u.detail}` });
			// (past its horizon the world stops: nothing after it would be a finding about the app)
			if (world.loop.now >= world.loop.horizon)
				broken.push({
					oracle: 'horizon',
					detail: `virtual time reached the run's horizon (${world.loop.horizon} ms) at action ${i + 1}`
				});
			// (a known one, a filed bug's, does not end the run: what comes after may be new)
			if (broken.some((b) => b.oracle !== 'known')) break;
		}
		if (broken.every((b) => b.oracle === 'known') && stop_at === Infinity) {
			for (const t of v.tabs) world.network.offline(t.name, false);
			await world.quiesce();
			// (a wait on its way out is not a hang: a backoff of seconds is a page's one-shot timer,
			// due later than rest's 2 s. Time runs on while one is set, a minute at most, then rest)
			const until = Math.min(world.loop.now + 60_000, world.loop.horizon);
			while (
				world.loop.now < until &&
				world.loop.next_at <= until &&
				v.tabs.some((t) => t.platform?.pending().includes('timeout'))
			)
				await world.loop.step();
			await world.quiesce();
			await at_rest?.(world, v);
			// AT REST, every tab (a faulted one too: a failure must end a wait as surely as an
			// answer): no machine left mid-work, and ogygia's rules hold
			for (const t of v.tabs)
				for (const b of [stuck(t), page_rules(t)])
					if (b) broken.push({ ...b, detail: `at rest: ${b.detail}` });
			for (const t of v.tabs) {
				if (dirty.has(t.name) || pressed.get(t.name) === t.documents || faulted(world, t)) continue;
				const b = await mpa_equivalent(world, v, t);
				if (b) broken.push(b);
			}
			const c = no_cross_visitor_cache(world);
			if (c) broken.push(c);
		}
		for (const b of broken) log.note(`broken ${b.oracle}: ${b.detail}`);
		return { seed, faults, actions, broken, steps: world.loop.ran, ms: 0, log: world.loop.log };
	} finally {
		await world.end();
	}
}

/** The first line where two traces differ, with a little before it; '' when they are equal. */
export function trace_difference(a: readonly string[], b: readonly string[]): string {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	if (i === a.length && i === b.length) return '';
	const from = Math.max(0, i - 3);
	return [
		`at line ${i + 1} of ${a.length} / ${b.length}:`,
		...a.slice(from, i + 2).map((l, k) => `${from + k === i ? '-' : ' '} ${l}`),
		'  ---',
		...b.slice(from, i + 2).map((l, k) => `${from + k === i ? '+' : ' '} ${l}`)
	].join('\n');
}

/** A run, timed in real ms. */
async function timed(seed: number, steps: number, stop_at: number): Promise<RunResult> {
	const t = wall();
	const res = await run(seed, steps, stop_at);
	return { ...res, ms: wall() - t };
}

async function main(): Promise<void> {
	if (!existsSync(join(OUTPUT, 'server', 'index.js'))) {
		console.error(`no build at ${OUTPUT}: run \`OGYGIA_RULES=1 npx vite build\` in ${APP}`);
		process.exit(2);
	}
	const started = wall();
	const pool = new Pool(JOBS);
	const seeds = Array.from({ length: RUNS }, (_, i) => FIRST + i);
	// each seed's first run, and its replay (on another worker where there are two)
	const runs = seeds.map(async (seed): Promise<[RunResult, RunResult | null]> => {
		const first = await pool.run(seed, STEPS, STOP_AT);
		const again = REPLAY ? await pool.run(seed, STEPS, STOP_AT, first.worker) : null;
		return [first.result, again?.result ?? null];
	});
	const results: RunResult[] = [];
	const leaks: Array<{ seed: number; difference: string }> = [];
	let failed = 0;
	let known = 0;
	// reported in seed order, each as soon as it and every seed before it are done
	for (const [i, pending] of runs.entries()) {
		const [res, again] = await pending;
		const seed = seeds[i];
		results.push(res);
		let replay = '';
		if (again !== null) {
			results.push(again);
			const diff = trace_difference(res.log, again.log);
			replay = diff === '' ? '  replay: same' : '  replay: DIFFERENT';
			if (diff !== '') leaks.push({ seed, difference: diff });
		}
		const fresh = res.broken.filter((b) => b.oracle !== 'known');
		const mark = fresh.length ? 'FAIL' : res.broken.length ? 'KNWN' : 'ok  ';
		console.log(
			`${mark} seed ${seed}  ${res.actions.length} actions, ${res.steps} loop steps, ${Math.round(res.ms)} ms  faults: ${res.faults.join(',') || 'none'}${replay}`
		);
		if (STOP_AT !== Infinity) console.log(res.log.join('\n'));
		const leak = leaks.find((l) => l.seed === seed);
		if (leak)
			console.log(
				`  the replay differs (a nondeterminism leak):\n    ${leak.difference.split('\n').join('\n    ')}`
			);
		if (fresh.length) failed++;
		else if (res.broken.length) known++;
		if (res.broken.length) {
			if (fresh.length)
				console.log(res.actions.map((a, i) => `  ${i + 1}. ${describe(a)}`).join('\n'));
			for (const b of res.broken)
				console.log(`  [${b.oracle}] ${b.detail.split('\n').join('\n    ')}`);
		}
	}
	pool.end();
	const steps = results.reduce((n, r) => n + r.steps, 0);
	const actions = results.reduce((n, r) => n + r.actions.length, 0);
	const elapsed = wall() - started;
	const summary = {
		app: APP,
		runs: RUNS,
		jobs: JOBS,
		failed,
		known,
		replay_checked: REPLAY,
		replay_leaks: leaks.map((l) => l.seed),
		loop_steps: steps,
		seconds: Math.round(elapsed / 100) / 10,
		/** Loop steps per real second, over the whole pool (the replay runs included). */
		steps_per_second: Math.round((steps / elapsed) * 1000),
		actions_per_second: Math.round((actions / elapsed) * 10000) / 10,
		seeds_failed: results
			.filter((r, i) => r.broken.length && (!REPLAY || i % 2 === 0))
			.map((r) => ({ seed: r.seed, oracles: r.broken.map((b) => b.oracle) })),
		/** What each failing seed found (not what a filed bug explains), for the scheduled run's
		 *  triage (src/ci.ts): enough to file it, replay it and write its test. */
		findings: results
			.filter((_, i) => !REPLAY || i % 2 === 0)
			.flatMap((r) =>
				r.broken
					.filter((b) => b.oracle !== 'known')
					.map((b) => ({
						seed: r.seed,
						steps: STEPS,
						oracle: b.oracle,
						detail: b.detail,
						faults: r.faults,
						actions: r.actions.map(describe),
						trace_tail: r.log.slice(-40)
					}))
			)
	};
	writeFileSync(
		join(import.meta.dirname, '..', 'results.json'),
		JSON.stringify(summary, null, '\t') + '\n'
	);
	console.log(
		`\n${RUNS} seeds, ${failed} failed, ${known} known, ${leaks.length} replay leaks, ${JOBS} jobs, ${summary.seconds} s, ${summary.steps_per_second} loop steps/s, ${summary.actions_per_second} actions/s`
	);
	// (not `process.exit`: it cuts a long trace short on a pipe)
	process.exitCode = failed || leaks.length ? 1 : 0;
}

const JOBS = Math.max(
	1,
	Number(arg('--jobs') ?? Math.min(RUNS * (REPLAY ? 2 : 1), availableParallelism() - 1))
);
/** Runs a worker takes before it is replaced (each world's server graph stays loaded). */
const WORKER_RUNS = 25;

interface Job {
	seed: number;
	steps: number;
	stop_at: number;
	/** A worker not to use (the one that ran the seed first), when another is free. */
	avoid: number;
	resolve(r: { result: RunResult; worker: number }): void;
}

interface Worker {
	readonly id: number;
	readonly child: ChildProcess;
	runs: number;
	/** The tail of its stderr. */
	said: string;
}

/** Worker processes, each running one world at a time. */
class Pool {
	readonly #queue: Job[] = [];
	readonly #idle: Worker[] = [];
	#made = 0;
	#live = 0;
	readonly #size: number;

	constructor(size: number) {
		this.#size = size;
	}

	run(
		seed: number,
		steps: number,
		stop_at: number,
		avoid = -1
	): Promise<{ result: RunResult; worker: number }> {
		return new Promise((resolve) => {
			this.#queue.push({ seed, steps, stop_at, avoid, resolve });
			this.#pump();
		});
	}

	#spawn(): Worker {
		const passed = [
			...(arg('--app') !== undefined ? ['--app', APP] : []),
			...(arg('--hang-ms') !== undefined ? ['--hang-ms', arg('--hang-ms')!] : [])
		];
		const child = fork(import.meta.filename, ['--worker', ...passed], {
			execArgv: ['--experimental-vm-modules', '--no-warnings'],
			stdio: ['ignore', 'ignore', 'pipe', 'ipc']
		});
		this.#live++;
		const w: Worker = { id: ++this.#made, child, runs: 0, said: '' };
		// (what it last wrote to stderr: why it died, if it dies)
		child.stderr?.on('data', (d: Buffer) => {
			w.said = (w.said + d.toString()).slice(-4000);
		});
		return w;
	}

	/** Hands queued jobs to free workers. A replay waits for another worker than its first run's
	 *  (one is always busy or can be made, unless the pool has one). */
	#pump(): void {
		next: while (this.#queue.length > 0) {
			for (const [i, w] of this.#idle.entries()) {
				const at = this.#queue.findIndex((j) => j.avoid !== w.id || this.#size === 1);
				if (at === -1) continue;
				this.#idle.splice(i, 1);
				this.#send(w, this.#queue.splice(at, 1)[0]);
				continue next;
			}
			if (this.#live >= this.#size) return;
			this.#send(this.#spawn(), this.#queue.shift()!);
		}
	}

	#send(w: Worker, job: Job): void {
		// (a run that throws, or a worker that dies, is the seed's finding: the simulator's own
		// failure, to be triaged like any other, and the pool goes on)
		const crashed = (why: string, oracle = 'crash'): { result: RunResult; worker: number } => ({
			worker: w.id,
			result: {
				seed: job.seed,
				faults: [],
				actions: [],
				broken: [{ oracle, detail: why }],
				steps: 0,
				ms: 0,
				log: [`${oracle}: ${why.split('\n')[0]}`]
			}
		});
		const done = (message: { result?: RunResult; error?: string; hung?: string }) => {
			w.child.off('exit', died);
			job.resolve(
				message.hung !== undefined
					? crashed(message.hung, 'hung')
					: message.result === undefined
						? crashed(`the run threw: ${message.error}`)
						: { result: message.result, worker: w.id }
			);
			// (a hung run's worker ends itself)
			if (message.hung !== undefined || ++w.runs >= WORKER_RUNS) {
				w.child.kill();
				this.#live--;
			} else this.#idle.push(w);
			this.#pump();
		};
		const died = (code: number | null) => {
			w.child.off('message', done);
			this.#live--;
			job.resolve(
				crashed(`its worker exited (${code}) after ${w.runs} runs; it last said:\n${w.said}`)
			);
			this.#pump();
		};
		w.child.once('message', done);
		w.child.once('exit', died);
		w.child.send({ seed: job.seed, steps: job.steps, stop_at: job.stop_at });
	}

	end(): void {
		for (const w of this.#idle) w.child.kill();
		this.#idle.length = 0;
	}
}

/** A worker: runs the seeds it is sent, one at a time, and sends each result back. */
function worker(): void {
	// (the pool went away: nothing more will come)
	process.on('disconnect', () => process.exit(0));
	process.on('message', (job: { seed: number; steps: number; stop_at: number }) => {
		// THE WATCHDOG: a run that has not ended after HANG_MS of real time is hung (a wait nobody
		// will ever end: the simulator's, or the app's). What it was waiting on goes back as its
		// finding, and the worker ends: its host is in a state no next run should meet.
		const watchdog = real_timeout(() => {
			process.send!({ hung: hung_report(job.seed) }, () => process.exit(3));
		}, HANG_MS);
		timed(job.seed, job.steps, job.stop_at ?? Infinity).then(
			(result) => {
				clearRealTimeout(watchdog);
				process.send!({ result });
			},
			(error: unknown) => {
				clearRealTimeout(watchdog);
				process.send!({ error: String((error as Error)?.stack ?? error) });
			}
		);
	});
}

/** Real ms a run may take before it is called hung (a 40-action run takes a few seconds). */
const HANG_MS = Number(arg('--hang-ms') ?? 60_000);

/** The world of the run in progress (for a hung run's report). */
let running: World | null = null;

/** What a hung run was doing: where it stood, what was queued, what was on the wire, the trace's
 *  tail, and each tab's machine moves (`__ogygia_moves`, with rules on). */
function hung_report(seed: number): string {
	const w = running;
	if (w === null) return `seed ${seed}: hung before its world was made`;
	const lines: string[] = [];
	const actions = w.loop.log.filter((l) => l.includes(' # action '));
	lines.push(
		`seed ${seed}: hung at virtual ${w.loop.now} ms, ${w.loop.ran} loop steps, ${actions.length} actions begun (last: ${actions.at(-1) ?? 'none'})`
	);
	const queued = w.loop.queued();
	lines.push(`queued tasks (${queued.length}), first 20:`);
	for (const t of queued.slice(0, 20)) lines.push(`  ${t.at} ${t.realm} ${t.label}`);
	const wire = w.network.exchanges.filter((e) => e.status === 'pending');
	lines.push(`requests with no answer yet (${wire.length}):`);
	for (const e of wire.slice(-20)) lines.push(`  ${e.id} ${e.from} ${e.method} ${e.url}`);
	lines.push(
		`host real timers at the last settle: ${w.loop.real_timers}, settles that gave up: ${w.loop.stalls}`
	);
	lines.push(`host resources now: ${process.getActiveResourcesInfo().join(', ')}`);
	lines.push('trace tail:', ...w.loop.log.slice(-40).map((l) => `  ${l}`));
	for (const v of w.browsers.visitors)
		for (const t of v.tabs) {
			const win = t.page.mainFrame.window as unknown as { __ogygia_moves?: () => string };
			const moves = win.__ogygia_moves?.().split('\n').slice(-15) ?? [];
			lines.push(`${v.name} ${t.name} ${t.page.mainFrame.url}: last machine moves:`);
			lines.push(...moves.map((m) => `  ${m}`));
		}
	return lines.join('\n');
}

if (import.meta.main) {
	if (process.argv.includes('--worker')) worker();
	else await main();
}
