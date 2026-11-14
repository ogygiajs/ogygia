// The e2e harness's `spawn_server`: real child processes on real ports. A spec kills its server and
// the next spec starts one on the same port, so `kill()` must end the server (not just signal it),
// and a port someone else holds must fail the spawn, naming the port, instead of being shared.
import { createServer as create_http, type Server } from 'node:http';
import { connect, createServer as create_net } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawn_server, type SpawnedServer } from '../src/e2e/servers.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/http-server.ts', import.meta.url));
const CWD = fileURLToPath(new URL('.', import.meta.url));

const args = (opts: Record<string, string | number>) => [
	FIXTURE,
	...Object.entries(opts).map(([k, v]) => `${k}=${v}`)
];

/** A port nothing listens on right now. */
async function free_port(): Promise<number> {
	const probe = create_net();
	await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
	const { port } = probe.address() as { port: number };
	await new Promise((r) => probe.close(r));
	return port;
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

const spawned: SpawnedServer[] = [];
const strangers: Server[] = [];
afterEach(async () => {
	for (const s of spawned.splice(0)) await s.kill();
	for (const s of strangers.splice(0)) await new Promise((r) => s.close(r));
});

describe('spawn_server', () => {
	it('kill() resolves once the server is gone: the port is free right after', async () => {
		const port = await free_port();
		const server = await spawn_server({
			cmd: process.execPath,
			args: args({ port, id: 'a', exit_delay: 1500 }),
			cwd: CWD,
			url: `http://127.0.0.1:${port}/`
		});
		spawned.push(server);
		await server.kill();
		expect(await refused(port)).toBe(true);
	}, 30_000);

	it('a server that ignores SIGTERM is killed after the grace time', async () => {
		const port = await free_port();
		const server = await spawn_server({
			cmd: process.execPath,
			args: args({ port, id: 'a', exit_delay: 'never', life: 20_000 }),
			cwd: CWD,
			url: `http://127.0.0.1:${port}/`
		});
		spawned.push(server);
		const t0 = performance.now();
		await server.kill();
		expect(performance.now() - t0).toBeLessThan(12_000);
		expect(await refused(port)).toBe(true);
	}, 30_000);

	it('a port someone else keeps holding fails the spawn, naming the port', async () => {
		const port = await free_port();
		const stranger = create_http((_req, res) => res.end('stranger'));
		await new Promise<void>((r) => stranger.listen(port, '127.0.0.1', r));
		strangers.push(stranger);
		const spawning = spawn_server({
			cmd: process.execPath,
			args: args({ port, id: 'a' }),
			cwd: CWD,
			url: `http://127.0.0.1:${port}/`
		}).then((server) => {
			spawned.push(server);
			return `spawned onto the busy port (pid ${server.child.pid})`;
		});
		await expect(spawning).rejects.toThrow(`port ${port}`);
	}, 30_000);
});
