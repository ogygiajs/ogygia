import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('the message tables', () => {
	it('load under plain Node, which has no import.meta.env', () => {
		const messages = fileURLToPath(new URL('../src/messages.ts', import.meta.url));
		const r = spawnSync(
			process.execPath,
			['--input-type=module', '-e', `await import(${JSON.stringify(messages)});`],
			{ encoding: 'utf8' }
		);
		expect(r.stderr).toBe('');
		expect(r.status).toBe(0);
	});
});
