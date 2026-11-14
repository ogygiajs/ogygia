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
import { setTimeout as pause } from 'node:timers/promises';
import { clock, machine } from '@ogygia/machine';
import { append_server_log } from './server-log.ts';

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
 * One server, from its spawn to its exit:
 *
 *   spawning ─ ready ─ stopping ─ exited
 *       │        │                  │
 *       └────────┴── exited_early ──┘     (it exited before kill(): on boot, or mid-spec)
 *
 * `ready` is reached only while our own child is still in its spawning visit, so the answer was
 * its. `exited` is reached only when its whole process group is gone (a wrapper such as pnpm can
 * exit first and leave the server on the port).
 */
type ServerStates = {
	spawning: {};
	ready: {};
	stopping: {};
	exited_early: { how: string };
	exited: {};
};
const server_machine = machine<ServerStates>()({
	name: 'e2e server',
	initial: 'spawning',
	steps: {
		spawning: ['ready', 'stopping', 'exited_early'],
		ready: ['stopping', 'exited_early'],
		stopping: ['exited'],
		exited_early: ['exited'],
		exited: []
	}
});

/** `ms` later, or at once when `signal` aborts. Its timer holds the process open, as a wait the
 *  test run itself awaits must (a scope's timer does not). */
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	pause(ms, undefined, { signal }).catch((error: unknown) => {
		if (!signal?.aborted) throw error;
	});

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
	const free_by = clock.mono() + PORT_WAIT_MS;
	while (await port_held(host, port_number)) {
		if (clock.mono() >= free_by)
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
	// (kept in the suite's server log too: each test reads the server rules said while it ran)
	child.stdout?.on('data', (d) => (logs.push(String(d)), append_server_log(d)));
	child.stderr?.on('data', (d) => (logs.push(String(d)), append_server_log(d)));
	const closed = new Promise<void>((r) => child.once('close', () => r()));
	const pid = child.pid;
	const signal_group = (sig: NodeJS.Signals) => {
		try {
			if (pid !== undefined) process.kill(-pid, sig);
			// oxlint-disable-next-line ogygia/no-silent-failures -- the group already exited (ESRCH), which is what the signal was for
		} catch {}
	};

	const m = server_machine.create();
	// the child's exit: unasked (exited_early) or asked (stopping); either way `exited` only once
	// nothing of its group is left
	let exit_how: string | null = null;
	const on_exit = async (how: string) => {
		if (exit_how !== null) return;
		exit_how = how;
		const unasked =
			m.move('spawning', 'exited_early', { how }) || m.move('ready', 'exited_early', { how });
		if (unasked) signal_group('SIGKILL');
		while (pid !== undefined && group_alive(pid)) await sleep(25);
		// (its last output read too, for a failure message: the pipes close once no writer is left)
		await Promise.race([closed, sleep(1000)]);
		if (!m.move('stopping', 'exited')) m.move('exited_early', 'exited');
	};
	// oxlint-disable-next-line ogygia/no-silent-failures -- on_exit never rejects
	child.once('exit', (code, sig) => void on_exit(sig ? `signal ${sig}` : `code ${code}`));
	child.once('error', (error) => {
		logs.push(error.message);
		// oxlint-disable-next-line ogygia/no-silent-failures -- on_exit never rejects
		void on_exit(error.message);
	});

	const server: SpawnedServer = {
		child,
		logs,
		async kill() {
			if (m.move('spawning', 'stopping') || m.move('ready', 'stopping')) {
				signal_group('SIGTERM');
				// (the stopping visit's: an exit before it clears it; the child holds the process meanwhile)
				m.scope.timeout(() => signal_group('SIGKILL'), KILL_GRACE_MS);
			}
			await m.wait('exited');
		},
		tail(n = 20) {
			return logs.join('').split('\n').slice(-n).join('\n');
		}
	};
	const ready = opts.ready ?? (() => true);
	const start = clock.mono();
	const timeout = opts.timeout_ms ?? 60_000;
	const answered = await m.scope.task(async (signal) => {
		while (clock.mono() - start < timeout && !signal.aborted) {
			try {
				const res = await fetch(opts.url, { redirect: 'manual', signal });
				if (res.status > 0 && ready(res)) return true;
				// oxlint-disable-next-line ogygia/no-silent-failures -- not up yet; the loop asks again until the timeout says so
			} catch {}
			await sleep(300, signal);
		}
		return false;
	});
	// (still in this spawning visit: our child has not exited, so the answer was its)
	if (answered === true && m.move('spawning', 'ready')) return server;
	if (m.now.kind !== 'spawning') {
		await m.wait('exited');
		throw new Error(`server exited early (${what}) — ${exit_how}\n${server.tail()}`);
	}
	await server.kill();
	throw new Error(`server never came up at ${opts.url} within ${timeout}ms\n${server.tail()}`);
}
