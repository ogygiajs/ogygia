// What an outbox does with the options it is not given. Real timers, in node and in a real browser.
import { describe, expect, it } from 'vitest';
import { outbox } from '../src/index.ts';

describe('outbox defaults', () => {
	it('with no retry, a failed send is tried again by the standard policy', async () => {
		let tries = 0;
		const box = outbox({
			send: () => {
				if (++tries === 1) throw new Error('down');
			},
			giveUp: () => {}
		});
		expect(await box.put('x')).toBe(true);
		expect(tries).toBe(2);
	});
});
