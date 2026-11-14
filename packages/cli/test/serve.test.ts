/**
 * `ogygia bisect`'s server: real child processes on real ports. Bisect stops one commit's server
 * and serves the next on the same port, so a stop must end the server (not just signal it), and a
 * serve must be answered by its own server, never by the one before it or by a stranger.
 */
import { createServer as create_http, type Server } from 'node:http';
import { connect, createServer as create_net } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '../src/perf/cli.ts';

const FIXTURE = fileURLToPath(
	new URL('../../tooling/test/fixtures/http-server.ts', import.meta.url)
);
const CWD = fileURLToPath(new URL('.', import.meta.url));

/** The command that starts the fixture server with these options. */
const cmd = (opts: Record<string, string | number>) =>
	[process.execPath, FIXTURE, ...Object.entries(opts).map(([k, v]) => `${k}=${v}`)]
		.map((part) => JSON.stringify(String(part)))
		.join(' ');

/** A port nothing listens on right now. */
async function free_port(): Promise<number> {
	const probe = create_net();
	await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
	const { port } = probe.address() as { port: number };
	await new Promise((r) => probe.close(r));
	return port;
}

/** The body the port answers with, or null when nothing answers. */
async function answer(port: number): Promise<string | null> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
		return await res.text();
	} catch {
		return null;
	}
}

/** Nothing accepts a connection on the port. */
function refused(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect(port, '127.0.0.1');
		socket.once('connect', () => {
			socket.destroy();
			resolve(false);
		});
		socket.once('error', () => resolve(true));
	});
}

const stoppers: (() => unknown)[] = [];
const strangers: Server[] = [];
afterEach(async () => {
	for (const stop of stoppers.splice(0)) await stop();
	for (const s of strangers.splice(0)) await new Promise((r) => s.close(r));
});

async function stranger(port: number): Promise<void> {
	const s = create_http((_req, res) => res.end('stranger'));
	await new Promise<void>((r) => s.listen(port, '127.0.0.1', r));
	strangers.push(s);
}

describe('bisect server', () => {
	it('stop then serve again on the same port: the answer is the new server, never the old one', async () => {
		const port = await free_port();
		const url = `http://127.0.0.1:${port}/`;
		const stop_a = await serve(cmd({ port, id: 'a', exit_delay: 2000 }), CWD, url, 10_000);
		stoppers.push(stop_a);
		expect(await answer(port)).toBe('a');
		await stop_a();
		const stop_b = await serve(cmd({ port, id: 'b' }), CWD, url, 10_000);
		stoppers.push(stop_b);
		expect(await answer(port)).toBe('b');
	}, 30_000);

	it('stop resolves once the server is gone: the port is free right after', async () => {
		const port = await free_port();
		const url = `http://127.0.0.1:${port}/`;
		const stop = await serve(cmd({ port, id: 'a', exit_delay: 1500 }), CWD, url, 10_000);
		stoppers.push(stop);
		await stop();
		expect(await refused(port)).toBe(true);
	}, 30_000);

	it('stop waits for the server behind a wrapper that exits at once', async () => {
		const port = await free_port();
		const url = `http://127.0.0.1:${port}/`;
		const stop = await serve(cmd({ port, id: 'a', exit_delay: 1500, wrap: 1 }), CWD, url, 10_000);
		stoppers.push(stop);
		await stop();
		expect(await refused(port)).toBe(true);
	}, 30_000);

	it('a server that ignores SIGTERM is killed after the grace time', async () => {
		const port = await free_port();
		const url = `http://127.0.0.1:${port}/`;
		const stop = await serve(cmd({ port, id: 'a', exit_delay: 'never' }), CWD, url, 10_000, 500);
		stoppers.push(stop);
		const t0 = Date.now();
		await stop();
		expect(Date.now() - t0).toBeLessThan(5000);
		expect(await refused(port)).toBe(true);
	}, 30_000);

	it('a port someone else holds is refused, naming the port', async () => {
		const port = await free_port();
		await stranger(port);
		const url = `http://127.0.0.1:${port}/`;
		const served = serve(cmd({ port, id: 'a' }), CWD, url, 1500).then((stop) => {
			stoppers.push(stop);
			return answer(port);
		});
		await expect(served).rejects.toThrow(String(port));
	}, 30_000);

	it('a server that exits at once fails at once, with its output', async () => {
		const held = await free_port();
		await stranger(held);
		const port = await free_port();
		const url = `http://127.0.0.1:${port}/`;
		const t0 = Date.now();
		// it tries to listen on the held port (EADDRINUSE) and exits; nothing ever answers `url`
		const asked = vi.spyOn(globalThis, 'fetch');
		const failed = await serve(cmd({ port: held, id: 'a' }), CWD, url, 8000).catch(
			(e: unknown) => e as Error
		);
		expect(failed).toBeInstanceOf(Error);
		expect((failed as Error).message).toContain('EADDRINUSE');
		expect((failed as Error).message).toContain('cli_server_exited_early');
		expect(Date.now() - t0).toBeLessThan(5000);
		const after = asked.mock.calls.length;
		await new Promise((r) => setTimeout(r, 500));
		expect(asked.mock.calls.length).toBe(after);
		asked.mockRestore();
	}, 30_000);
});
