// A REGION ELEMENT'S MAILBOX in a real browser (src/runtime/mailbox.ts): its turns under the
// browser's own promise order and timers, and a long queue on the browser's own stack.
import { describe, expect, it } from 'vitest';
import { scope } from '@ogygia/machine';
import { mailbox } from '../../src/runtime/mailbox.ts';

const later = <T>(value: T, ms = 1) => new Promise<T>((r) => setTimeout(() => r(value), ms));

describe('mailbox in a browser', () => {
	it('a handler waiting on two things at once lets one event in, not two at once (#341)', async () => {
		const box = mailbox(scope());
		let on = 0;
		let most = 0;
		const busy = async () => {
			most = Math.max(most, ++on);
			await later(null, 20);
			on--;
		};
		await box.ask(async (turn) => {
			box.post(busy);
			box.post(busy);
			await Promise.all([turn.wait(later(1, 5)), turn.wait(later(2, 5))]);
			most = Math.max(most, ++on);
			on--;
		});
		await later(null, 60);
		expect(most).toBe(1);
	});

	it('a timer of a handler that waits after its turn ended takes nobody’s turn (#341)', async () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		box.post((turn) => {
			setTimeout(() => void turn.wait(later(null)), 0);
		});
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		const b = box.ask(async () => {
			seen.push('b holds');
			await gate;
			seen.push('b ends');
		});
		box.post(() => seen.push('c'));
		await later(null, 20);
		expect(seen).toEqual(['b holds']);
		open();
		await b;
		await Promise.resolve();
		expect(seen).toEqual(['b holds', 'b ends', 'c']);
	});

	it('runs a long run of sync events queued in one turn, on a flat stack (#342)', () => {
		const box = mailbox(scope());
		let n = 0;
		box.post(() => {
			for (let i = 0; i < 50_000; i++) box.post(() => n++);
		});
		expect(n).toBe(50_000);
	});
});
