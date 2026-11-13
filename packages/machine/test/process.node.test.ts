// What a real Node process does with the primitives: whether it stays alive for their work, and
// what it can collect. Each case runs in a process of its own (`node`, type stripping), so its
// event loop and its garbage are its own. Node only: the browser project leaves this file out.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

// a cold Node start with type stripping, on a busy CI runner (#1473)
const PROCESS_BUDGET = 20_000;

function run(fixture: string, flags: string[] = []): string {
	const file = fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url));
	return execFileSync(process.execPath, [...flags, file], {
		encoding: 'utf8',
		timeout: PROCESS_BUDGET
	}).trim();
}

describe('a Node process', { timeout: PROCESS_BUDGET }, () => {
	it('stays alive through the wait between two tries of a send (#351)', () => {
		expect(run('exit-during-backoff.ts')).toBe('done true after 2 tries');
	});

	it('collects a flights nobody holds, and its world forgets it (#352)', () => {
		expect(run('world-forgets-flights.ts', ['--expose-gc'])).toBe('1 dropped');
	});

	it('frees a symbol a keyed flights spelled into a key, once nothing holds it (#357)', () => {
		expect(run('symbol-keys-freed.ts', ['--expose-gc'])).toBe('freed');
	});

	it('loads any module of the package first: no import cycle runs a module before its classes', async () => {
		// each module first in a module graph of its own: a worker thread has its own, and they all
		// start at once (one process per module, one after another, outgrew the test's time)
		const dir = fileURLToPath(new URL('../src/', import.meta.url));
		const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
		const loaded = await Promise.all(
			files.map(
				(file) =>
					new Promise<string>((done) => {
						const w = new Worker(
							`import(${JSON.stringify(pathToFileURL(dir + file).href)}).then(() => 'loaded', (e) => String(e)).then((r) => require('node:worker_threads').parentPort.postMessage(r))`,
							{ eval: true }
						);
						w.once('message', (r: string) => {
							done(r);
							void w.terminate(); // ok: the worker's one answer is in
						});
						w.once('error', (e) => done(String(e)));
					})
			)
		);
		expect(Object.fromEntries(files.map((f, i) => [f, loaded[i]]))).toEqual(
			Object.fromEntries(files.map((f) => [f, 'loaded']))
		);
	});
});
