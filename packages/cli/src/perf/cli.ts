/**
 * `ogygia perf` and `ogygia bisect` — the runners around the pure modules. Loaded by the CLI on
 * demand (a sibling in dist), so the CLI bundle stays small.
 *
 *   ogygia perf --url http://127.0.0.1:4173 --pages /,/docs [--runs 5] [--key $SECRET]
 *               [--baseline perf-baseline.json] [--budget budget.json] [--out perf-snapshot.json]
 *               [--md perf-comment.md] [--label "$GITHUB_SHA"] [--no-fail]
 *
 *   ogygia bisect --good <sha> --bad <sha> --page /slow --build "pnpm build" --start "node build"
 *                 --url http://127.0.0.1:3000 [--key $SECRET] [--runs 3] [--margin 0.5] [--ready 60000]
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { clock, machine } from '@ogygia/machine';
import { OgygiaError } from '../messages.ts';
import { measure, type PerfSnapshot } from './measure.ts';
import { verdict, type Budget } from './compare.ts';
import { markdown, summary } from './report.ts';
import { bisect } from './bisect.ts';
import { dedent } from '@ogygia/core/plugin/utils';

function arg(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	if (i === -1) return undefined;
	const v = argv[i + 1];
	return v && !v.startsWith('--') ? v : '';
}
const has = (argv: string[], name: string) => argv.includes(name);

/** A number flag: its value whenever it parses, `0` included (`Number(v) || d` turns a real 0 into
 *  the default); `fallback` when the flag is absent, empty or not a number. */
export function number_arg(argv: string[], name: string, fallback: number): number {
	const raw = arg(argv, name);
	if (raw === undefined || raw.trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

function read_json<T>(file: string | undefined): T | null {
	if (!file || !existsSync(file)) return null;
	return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export async function runPerf(argv: string[]): Promise<number> {
	const url = arg(argv, '--url');
	const pages = (arg(argv, '--pages') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const pages_file = arg(argv, '--pages-file');
	if (pages_file) {
		const list = read_json<string[] | { pages: string[] }>(pages_file);
		if (Array.isArray(list)) pages.push(...list);
		else if (list?.pages) pages.push(...list.pages);
	}
	if (!url || !pages.length) {
		process.stderr.write(
			'ogygia perf: --url <origin> and --pages /a,/b (or --pages-file) are required\n'
		);
		return 2;
	}
	const runs = Number(arg(argv, '--runs')) || 5;
	const key = arg(argv, '--key') ?? process.env.OGYGIA_PROFILER_SECRET;
	const base = arg(argv, '--base');
	const label = arg(argv, '--label');
	const budget = read_json<Budget>(arg(argv, '--budget')) ?? {};
	const baseline = read_json<PerfSnapshot>(arg(argv, '--baseline'));
	process.stdout.write(
		`ogygia perf · ${pages.length} page${pages.length === 1 ? '' : 's'} × ${runs} runs on ${url}${baseline ? ' · against the baseline' : ' · no baseline (caps only)'}\n`
	);
	let snap: PerfSnapshot;
	try {
		snap = await measure({
			url,
			pages,
			runs,
			key,
			base,
			label,
			on_page: (p) => process.stdout.write(`  measured ${p.page}: ${p.render_p50.toFixed(1)} ms\n`)
		});
	} catch (e) {
		process.stderr.write(`ogygia perf: ${e instanceof Error ? e.message : String(e)}\n`);
		return 2;
	}
	const out = arg(argv, '--out');
	if (out) writeFileSync(out, JSON.stringify(snap, null, 2));
	const v = verdict(baseline, snap, budget);
	const md = arg(argv, '--md');
	if (md)
		writeFileSync(md, markdown(v, { title: label ? `Performance (${label})` : 'Performance' }));
	process.stdout.write(`${summary(v)}\n`);
	if (out) process.stdout.write(`snapshot: ${out}${md ? ` · comment: ${md}` : ''}\n`);
	return v.ok || has(argv, '--no-fail') ? 0 : 1;
}

function sh(cmd: string, cwd: string, timeout_ms: number): void {
	execSync(cmd, { cwd, stdio: 'inherit', timeout: timeout_ms, env: { ...process.env, CI: '1' } });
}

/**
 * One commit's server, from its spawn to its exit. Bisect stops one commit's server and starts
 * the next on the same port, so every step here is about whose server answers:
 *
 *   spawning ─ ready ─ stopping ─ exited
 *       │        │                  │
 *       └────────┴── exited_early ──┘     (it exited before we asked: on boot, or while measured)
 *
 * `ready` is reached only while our own child is still running and the port was free before it
 * started, so the answer is its. `exited` is reached only when its whole process group is gone (a
 * wrapper such as a package manager can exit first and leave the server on the port).
 */
type ServerStates = {
	spawning: {};
	ready: {};
	stopping: {};
	exited_early: { how: string };
	exited: {};
};
const server_machine = machine<ServerStates>()({
	name: 'bisect server',
	initial: 'spawning',
	steps: {
		spawning: ['ready', 'stopping', 'exited_early'],
		ready: ['stopping', 'exited_early'],
		stopping: ['exited'],
		exited_early: ['exited'],
		exited: []
	}
});

/** How long a stopped server has to exit on SIGTERM before its group gets SIGKILL. */
const STOP_GRACE_MS = 10_000;
/** The server's output kept for a failure message: its last lines, from at most this much. */
const OUTPUT_LINES = 40;
const OUTPUT_CHARS = 64 * 1024;

/** `ms` later, or at once when `signal` aborts. Its timer holds the process open, as a wait the
 *  command itself awaits must (a scope's timer does not). */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	pause(ms, undefined, { signal }).catch((error: unknown) => {
		if (!signal?.aborted) throw error;
	});

/** Something accepts a connection at `host:port` (an HTTP server or not: either would get in the
 *  way of the readiness check). */
function port_held(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port });
		socket.setTimeout(1000, () => (socket.destroy(), resolve(false)));
		socket.once('connect', () => (socket.destroy(), resolve(true)));
		socket.once('error', () => resolve(false));
	});
}

/** The process group still has a process in it. */
function group_alive(pid: number): boolean {
	try {
		process.kill(-pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/**
 * Start a server command and wait until `url` answers (within `ready_ms`, the wait for a free
 * port included). Returns its stop, which resolves once the server's whole process group has
 * exited (SIGTERM, then SIGKILL after `grace_ms`). Throws when the port stays held, when the server
 * exits before it answers (with its output), or when it never answers (stopped first).
 */
export async function serve(
	cmd: string,
	cwd: string,
	url: string,
	ready_ms: number,
	grace_ms: number = STOP_GRACE_MS
): Promise<() => Promise<void>> {
	const deadline = clock.mono() + ready_ms;
	const at = new URL(url);
	const host = at.hostname.replace(/^\[(.*)\]$/, '$1');
	const port = Number(at.port) || (at.protocol === 'https:' ? 443 : 80);
	// the port free first: whoever is on it would answer the readiness poll below
	while (await port_held(host, port)) {
		if (clock.mono() >= deadline)
			throw new OgygiaError('cli_server_port_busy', { url, port, ms: ready_ms });
		await sleep(200);
	}

	const m = server_machine.create();
	let output = '';
	const keep = (chunk: Buffer | string) => {
		output = `${output}${String(chunk)}`.slice(-OUTPUT_CHARS);
	};
	const tail = () => output.split('\n').slice(-OUTPUT_LINES).join('\n').trim();
	const child = spawn(cmd, {
		cwd,
		shell: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		// its own process group: a signal to it reaches the server behind any wrapper
		detached: true,
		env: { ...process.env }
	});
	child.stdout?.on('data', keep);
	child.stderr?.on('data', keep);
	const closed = new Promise<void>((r) => child.once('close', () => r()));
	const pid = child.pid;
	const signal_group = (sig: NodeJS.Signals) => {
		try {
			if (pid !== undefined) process.kill(-pid, sig);
		} catch {
			// ok: the group already exited (ESRCH), which is what the signal was for
		}
	};

	// the child's exit: unasked (exited_early) or asked (stopping); either way `exited` only once
	// nothing of its group is left
	let exit_seen = false;
	const on_exit = async (how: string) => {
		if (exit_seen) return;
		exit_seen = true;
		const unasked =
			m.move('spawning', 'exited_early', { how }) || m.move('ready', 'exited_early', { how });
		if (unasked) signal_group('SIGKILL');
		while (pid !== undefined && group_alive(pid)) await sleep(25);
		// (its last output read too, for a failure message: the pipes close once no writer is left)
		await Promise.race([closed, sleep(1000)]);
		if (!m.move('stopping', 'exited')) m.move('exited_early', 'exited');
	};
	child.once('exit', (code, sig) => void on_exit(sig ? `signal ${sig}` : `code ${code}`)); // ok: on_exit never rejects
	child.once('error', (error) => {
		keep(error.message);
		void on_exit(error.message); // ok: on_exit never rejects
	});

	const stop = async (): Promise<void> => {
		if (m.move('spawning', 'stopping') || m.move('ready', 'stopping')) {
			signal_group('SIGTERM');
			// (the stopping visit's: an exit before it clears it; the child holds the process meanwhile)
			m.scope.timeout(() => signal_group('SIGKILL'), grace_ms);
		}
		await m.wait('exited');
	};

	const answered = await m.scope.task(async (signal) => {
		while (clock.mono() < deadline && !signal.aborted) {
			try {
				const res = await fetch(url, {
					redirect: 'manual',
					signal: AbortSignal.any([signal, AbortSignal.timeout(2000)])
				});
				await res.body?.cancel();
				if (res.status < 500) return true;
			} catch {
				// ok: not up yet; the loop asks again until the timeout says so
			}
			await sleep(200, signal);
		}
		return false;
	});
	// (still in this spawning visit: our child has not exited, so the answer was its)
	if (answered === true && m.move('spawning', 'ready')) return stop;
	const now = m.now;
	if (now.kind === 'exited_early') {
		await m.wait('exited');
		throw new OgygiaError('cli_server_exited_early', { cmd, how: now.how, output: tail() });
	}
	await stop();
	throw new OgygiaError('cli_server_not_ready', { url, ms: ready_ms, output: tail() });
}

export async function runBisect(argv: string[]): Promise<number> {
	const good = arg(argv, '--good');
	const bad = arg(argv, '--bad') ?? 'HEAD';
	const page = arg(argv, '--page');
	const build = arg(argv, '--build');
	const start = arg(argv, '--start');
	const url = arg(argv, '--url');
	if (!good || !page || !build || !start || !url) {
		process.stderr.write(
			'ogygia bisect: --good <sha> --page /x --build "<cmd>" --start "<cmd>" --url <origin> are required (--bad defaults to HEAD)\n'
		);
		return 2;
	}
	const runs = Number(arg(argv, '--runs')) || 3;
	const key = arg(argv, '--key') ?? process.env.OGYGIA_PROFILER_SECRET;
	const margin = number_arg(argv, '--margin', 0.5);
	const ready_ms = Number(arg(argv, '--ready')) || 60_000;
	const build_ms = Number(arg(argv, '--build-timeout')) || 15 * 60_000;
	const repo = process.cwd();
	const commits = execSync(`git rev-list --reverse ${good}..${bad}`, {
		cwd: repo,
		encoding: 'utf8'
	})
		.trim()
		.split('\n')
		.filter(Boolean);
	if (!commits.length) {
		process.stderr.write(`ogygia bisect: no commits between ${good} and ${bad}\n`);
		return 2;
	}
	process.stdout.write(
		`ogygia bisect · ${commits.length} commits between ${good.slice(0, 7)} and ${bad.slice(0, 7)} · page ${page}\n`
	);
	const worktree = mkdtempSync(path.join(tmpdir(), 'ogygia-bisect-'));
	const measure_sha = async (sha: string): Promise<number | null> => {
		try {
			const dir = path.join(worktree, sha.slice(0, 12));
			if (!existsSync(dir)) sh(`git worktree add --detach "${dir}" ${sha}`, repo, 60_000);
			try {
				sh(build, dir, build_ms);
			} catch {
				process.stdout.write(`  ${sha.slice(0, 7)}: build failed — skipped\n`);
				return null;
			}
			const stop = await serve(start, dir, url, ready_ms);
			try {
				const snap = await measure({ url, pages: [page], runs, key });
				return snap.pages[0].render_p50;
			} finally {
				// (resolves once the server has exited: the worktree it runs from goes next, and the
				// next commit's server takes the same port)
				await stop();
			}
		} catch (e) {
			process.stdout.write(
				`  ${sha.slice(0, 7)}: ${e instanceof Error ? e.message : String(e)} — skipped\n`
			);
			return null;
		} finally {
			try {
				sh(`git worktree remove --force "${path.join(worktree, sha.slice(0, 12))}"`, repo, 60_000);
			} catch {
				// ok: the worktree is already gone, which is what the remove was for
			}
		}
	};
	try {
		const good_sha = execSync(`git rev-parse ${good}`, { cwd: repo, encoding: 'utf8' }).trim();
		const bad_sha = execSync(`git rev-parse ${bad}`, { cwd: repo, encoding: 'utf8' }).trim();
		process.stdout.write(`  measuring the ends…\n`);
		const good_value = await measure_sha(good_sha);
		const bad_value = await measure_sha(bad_sha);
		if (good_value === null || bad_value === null) {
			process.stderr.write('ogygia bisect: could not measure the good or the bad end\n');
			return 2;
		}
		process.stdout.write(`  good ${good_value.toFixed(1)} ms · bad ${bad_value.toFixed(1)} ms\n`);
		const result = await bisect({
			commits,
			good_value,
			bad_value,
			margin,
			measure: measure_sha,
			on_step: (s) =>
				process.stdout.write(
					`  ${s.sha.slice(0, 7)}: ${s.value === null ? 'skipped' : `${s.value.toFixed(1)} ms → ${s.bad ? 'bad' : 'good'}`} (${Math.round(s.ms / 1000)} s)\n`
				)
		});
		if (!result.culprit) {
			process.stdout.write(
				`no commit in the range crossed the bar (${result.bar.toFixed(1)} ms): the regression is not between these commits, or it is noise\n`
			);
			return 1;
		}
		const subject = execSync(`git log -1 --format=%s ${result.culprit}`, {
			cwd: repo,
			encoding: 'utf8'
		}).trim();
		process.stdout.write(
			`\n${dedent`
				first bad commit: ${result.culprit.slice(0, 7)} — ${subject}
				${result.last_good ? `last good: ${result.last_good.slice(0, 7)}\n` : ''}bar: ${result.bar.toFixed(1)} ms · ${result.steps.length} steps${result.skipped.length ? ` · skipped ${result.skipped.length}` : ''}
			`}\n`
		);
		return 0;
	} finally {
		rmSync(worktree, { recursive: true, force: true });
	}
}
