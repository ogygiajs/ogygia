// What a real Node process does with the primitives: whether it stays alive for their work, and
// what it can collect. Each case runs in a process of its own (`node`, type stripping), so its
// event loop and its garbage are its own. Node only: the browser project leaves this file out.
import { execFileSync } from 'node:child_process';
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
});
