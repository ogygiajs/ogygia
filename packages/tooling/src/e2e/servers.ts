// Boot a server for a spec (a fixture app's adapter-node output, a `vite dev` / `vite preview`, an
// emulator) and tear it down cleanly. The house rules, in one place:
// - `detached: true` → the child is its own process GROUP, so a signal reaches the real server even
//   when `cmd` is a wrapper (pnpm → vite); signalling only the wrapper orphans the server on the port.
// - the port must be free first: whoever is on it would answer the readiness poll. A port still held
//   after PORT_WAIT_MS fails the spawn, naming the port.
// - readiness is a poll of `url` (any HTTP answer by default — a 404 still means "up"), and counts
//   only while our own child is still running.
// - `kill()` resolves once the whole process group has exited (SIGKILL after a grace time), so the
//   next spec can take the port and remove the app's directory.
// - stdout/stderr are captured, and a boot failure throws WITH the log tail.
import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';

/** A port a suite owns, moved up by `E2E_PORT_OFFSET`: when one machine runs a suite as several
 *  groups at once (`pnpm test:e2e`), each group's servers sit in their own range. Every fixed port
 *  a spec or suite config uses goes through this. */
export function port(base: number): number {
	return base + Number(process.env.E2E_PORT_OFFSET || 0);
}

export interface SpawnServerOptions {
	cmd: string;
	args: string[];
	cwd: string;
	env?: Record<string, string | undefined>;
	/** Polled until it answers. */
	url: string;
	timeout_ms?: number;
	/** Custom readiness (default: any HTTP status). */
	ready?: (res: Response) => boolean;
}

export interface SpawnedServer {
	readonly child: ChildProcess;
	readonly logs: string[];
	/** Stop the server: SIGTERM to its process group, SIGKILL after a grace time. Resolves once
	 *  the whole group has exited (safe to call twice). */
	kill(): Promise<void>;
	/** Last N log lines, for a failure message. */
	tail(n?: number): string;
}

/** How long a held port is waited on before the spawn fails (a server of the last spec still
 *  shutting down frees it well within this). */
const PORT_WAIT_MS = 10_000;
/** How long a killed server has to exit on SIGTERM before its group gets SIGKILL. */
const KILL_GRACE_MS = 5_000;

/**
 * One server's lifecycle, as one value:
 *
 *   spawning ─ ready ─ stopping ─ exited
 *       │        │                  │
 *       └────────┴── exited_early ──┘     (it exited before kill(): on boot, or mid-spec)
 *
 * (A plain value, not an `@ogygia/machine` machine: that package is built and tested with this
 * one, so it cannot be a dependency of it.)
 */
type Life =
	| { kind: 'spawning' }
	| { kind: 'ready' }
	| { kind: 'stopping' }
	| { kind: 'exited_early'; how: string }
	| { kind: 'exited' };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Something accepts a connection at `host:port`. */
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

export async function spawn_server(opts: SpawnServerOptions): Promise<SpawnedServer> {
	const what = `${opts.cmd} ${opts.args.join(' ')}`;
	const at = new URL(opts.url);
	const host = at.hostname.replace(/^\[(.*)\]$/, '$1');
	const port_number = Number(at.port) || (at.protocol === 'https:' ? 443 : 80);
	const free_by = Date.now() + PORT_WAIT_MS;
	while (await port_held(host, port_number)) {
		if (Date.now() >= free_by)
			throw new Error(
				`port ${port_number} (${opts.url}) is still held by another process after ${PORT_WAIT_MS} ms: not starting ${what} onto it (a server of an earlier spec or run is still up)`
			);
		await sleep(200);
	}

	const logs: string[] = [];
	const child = spawn(opts.cmd, opts.args, {
		cwd: opts.cwd,
		env: { ...process.env, ...opts.env },
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true
	});
	child.stdout?.on('data', (d) => logs.push(String(d)));
	child.stderr?.on('data', (d) => logs.push(String(d)));
	const closed = new Promise<void>((r) => child.once('close', () => r()));
	const pid = child.pid;
	const signal_group = (sig: NodeJS.Signals) => {
		try {
			if (pid !== undefined) process.kill(-pid, sig);
		} catch {
			/* already gone */
		}
	};

	let life: Life = { kind: 'spawning' };
	// (read through a function where it is checked after an await: the exit handler moves it)
	const life_now = (): Life => life;
	let mark_exited!: () => void;
	const exited = new Promise<void>((r) => (mark_exited = r));
	let kill_timer: ReturnType<typeof setTimeout> | undefined;
	// the child's exit: `exited` only once nothing of its group is left
	let exit_how: string | null = null;
	const on_exit = async (how: string) => {
		if (exit_how !== null) return;
		exit_how = how;
		if (life.kind === 'spawning' || life.kind === 'ready') {
			life = { kind: 'exited_early', how };
			signal_group('SIGKILL');
		}
		while (pid !== undefined && group_alive(pid)) await sleep(25);
		clearTimeout(kill_timer);
		// (its last output read too, for a failure message: the pipes close once no writer is left)
		await Promise.race([closed, sleep(1000)]);
		life = { kind: 'exited' };
		mark_exited();
	};
	child.once('exit', (code, sig) => void on_exit(sig ? `signal ${sig}` : `code ${code}`));
	child.once('error', (error) => {
		logs.push(error.message);
		void on_exit(error.message);
	});

	const server: SpawnedServer = {
		child,
		logs,
		kill() {
			if (life.kind === 'spawning' || life.kind === 'ready') {
				life = { kind: 'stopping' };
				signal_group('SIGTERM');
				kill_timer = setTimeout(() => signal_group('SIGKILL'), KILL_GRACE_MS);
			}
			return exited;
		},
		tail(n = 20) {
			return logs.join('').split('\n').slice(-n).join('\n');
		}
	};
	const ready = opts.ready ?? (() => true);
	const start = Date.now();
	const timeout = opts.timeout_ms ?? 60_000;
	while (Date.now() - start < timeout && life_now().kind === 'spawning') {
		try {
			const res = await fetch(opts.url, { redirect: 'manual' });
			// (still spawning: our child has not exited, so the answer was its)
			if (res.status > 0 && ready(res) && life_now().kind === 'spawning') {
				life = { kind: 'ready' };
				return server;
			}
		} catch {
			/* not up yet */
		}
		await sleep(300);
	}
	if (life_now().kind !== 'spawning') {
		await exited;
		throw new Error(`server exited early (${what}) — ${exit_how}\n${server.tail()}`);
	}
	await server.kill();
	throw new Error(`server never came up at ${opts.url} within ${timeout}ms\n${server.tail()}`);
}
