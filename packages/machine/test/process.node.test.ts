// What a real Node process does with the primitives: whether it stays alive for their work, and
// what it can collect. Each case runs in a process of its own (`node`, type stripping), so its
// event loop and its garbage are its own. Node only: the browser project leaves this file out.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function run(fixture: string, flags: string[] = []): string {
	const file = fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url));
	return execFileSync(process.execPath, [...flags, file], {
		encoding: 'utf8',
		timeout: 20_000
	}).trim();
}

describe('a Node process', () => {
	it('stays alive through the wait between two tries of a send (#351)', () => {
		expect(run('exit-during-backoff.ts')).toBe('done true after 2 tries');
	});

	it('collects a flights nobody holds, and its world forgets it (#352)', () => {
		expect(run('world-forgets-flights.ts', ['--expose-gc'])).toBe('1 dropped');
	});

	it('frees a symbol a keyed flights spelled into a key, once nothing holds it (#357)', () => {
		expect(run('symbol-keys-freed.ts', ['--expose-gc'])).toBe('freed');
	});

	it('loads any module of the package first: no import cycle runs a module before its classes', () => {
		const dir = fileURLToPath(new URL('../src/', import.meta.url));
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
			const loaded = execFileSync(
				process.execPath,
				[
					'--input-type=module',
					'-e',
					`await import(${JSON.stringify(dir + file)}); console.log('loaded')`
				],
				{ encoding: 'utf8', timeout: 20_000 }
			).trim();
			expect(loaded, file).toBe('loaded');
		}
	});
});
