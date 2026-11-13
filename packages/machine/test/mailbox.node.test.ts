// What a real Node process hears from a mailbox: a handler's failure nobody asked for. Its own
// process, so the unhandled rejection is the fixture's, not the test run's. Node only.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('a mailbox in a Node process', () => {
	it('a posted handler that rejects later is an unhandled rejection, as a direct call’s would be', () => {
		const file = fileURLToPath(new URL('./fixtures/mailbox-unheard-throw.ts', import.meta.url));
		const out = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 });
		expect(out.trim().split('\n')[0]).toBe('unheard: late');
	});

	it('a posted handler that rejects later still ends its turn: the next one runs', () => {
		const file = fileURLToPath(new URL('./fixtures/mailbox-unheard-throw.ts', import.meta.url));
		const out = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 });
		expect(out.trim().split('\n')).toContain('next: ran');
	});
});
