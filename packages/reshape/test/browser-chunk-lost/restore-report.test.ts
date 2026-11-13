import { expect, test, vi } from 'vitest';
import { report_restores } from '../../src/restore-report.ts';

test('a restore report whose wording chunk does not load says nothing, throws nothing, and keeps the log', async () => {
	const printed = vi.spyOn(console, 'error').mockImplementation(() => {});
	const lost = import('../../src/messages.ts').then(
		() => false,
		() => true
	);
	expect(await lost).toBe(true);
	const log = [{ kind: 'mismatch', diff: 'demo-card: <b> lost' }];
	(window as { __og_restore_log?: unknown[] }).__og_restore_log = log;
	report_restores();
	await new Promise((r) => setTimeout(r, 100));
	expect(printed).not.toHaveBeenCalled();
	expect((window as { __og_restore_log?: unknown[] }).__og_restore_log).toBe(log);
	expect(log).toHaveLength(1);
});
