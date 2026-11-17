/**
 * The canaries' Kit app (kit-app.ts) owns the server it starts: once the app stops, or the process
 * that started it dies, the server is gone and its port is free (#1976). A server left behind holds
 * a port and memory and slows every later run on the machine.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { dedent } from '../../src/contract/dedent.ts';
import { KitApp } from './kit-app.ts';
import { KITS } from './upstream.ts';

vi.setConfig({ testTimeout: 120_000 });

const KIT = Object.values(KITS)[0];

/** The pids of the processes running from the app in `dir` (its Vite, by its path). */
function servers_in(dir: string): number[] {
	const out = execFileSync('ps', ['-ax', '-o', 'pid=,command='], {
		encoding: 'utf8'
	});
	return out
		.split('\n')
		.filter((line) => line.includes(`${dir}/node_modules/vite/`))
		.map((line) => Number.parseInt(line, 10));
}

function port_free(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = net.createServer();
		probe.once('error', () => resolve(false));
		probe.listen(port, () => probe.close(() => resolve(true)));
	});
}

/** Waits until `dir` runs no server and `port` is free, or `ms` passed; whether it got there. */
async function gone(dir: string, port: number, ms = 15_000): Promise<boolean> {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		if (servers_in(dir).length === 0 && (await port_free(port))) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return false;
}

const kill_all = (dir: string) => {
	for (const pid of servers_in(dir)) process.kill(pid, 'SIGKILL');
};

describe('a canary Kit app owns its server', () => {
	it('stops its server and frees its port when it stops', async () => {
		const app = await new KitApp(KIT, 'dev').start();
		const port = Number(new URL(app.url).port);
		expect(servers_in(app.dir)).not.toEqual([]);
		await app.stop();
		expect(servers_in(app.dir)).toEqual([]);
		expect(await port_free(port)).toBe(true);
	});

	it('leaves no server when it stops while it starts', async () => {
		const app = new KitApp(KIT, 'dev');
		const started = app.start().then(
			() => 'up',
			() => 'gave up'
		);
		await app.stop();
		await started;
		const left = servers_in(app.dir);
		kill_all(app.dir);
		expect(left).toEqual([]);
	});

	it('takes its server down with it when the process that started it is killed', async () => {
		const script = dedent`
			const { KitApp } = await import(${JSON.stringify(new URL('./kit-app.ts', import.meta.url).href)});
			const app = await new KitApp(${JSON.stringify(KIT)}, 'dev').start();
			console.log(JSON.stringify({ dir: app.dir, url: app.url }));
			setInterval(() => {}, 1000);
		`;
		const owner = spawn(process.execPath, ['--input-type=module', '-e', script], {
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let out = '';
		let err = '';
		owner.stderr.on('data', (d: Buffer) => (err += d.toString()));
		const up = await new Promise<{ dir: string; url: string }>((resolve, reject) => {
			owner.stdout.on('data', (d: Buffer) => {
				out += d.toString();
				if (out.includes('\n')) resolve(JSON.parse(out) as { dir: string; url: string });
			});
			owner.once('exit', (code) => reject(new Error(`the owner exited (${code}):\n${err}`)));
		});
		expect(servers_in(up.dir)).not.toEqual([]);
		owner.kill('SIGKILL');
		const port = Number(new URL(up.url).port);
		const ok = await gone(up.dir, port);
		kill_all(up.dir);
		fs.rmSync(up.dir, { recursive: true, force: true });
		expect(ok, 'the server outlived the process that started it').toBe(true);
	});
});
