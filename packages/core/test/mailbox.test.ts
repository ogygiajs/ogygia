// A REGION ELEMENT'S MAILBOX (src/runtime/mailbox.ts, #322): its events one at a time, in the order
// they came; a wait lets the next one in and comes back behind it; the owner closing drops what is
// queued and ends every wait with STALE at once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scope, STALE } from '@ogygia/machine';
import { CLOSED_BOX, mailbox, type Turn } from '../src/runtime/mailbox.ts';

const later = <T>(value: T, ms = 1) => new Promise<T>((r) => setTimeout(() => r(value), ms));

afterEach(() => {
	vi.restoreAllMocks();
});

describe('mailbox', () => {
	it('runs an event posted to an idle box at once, on the caller’s stack', () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		box.post(() => seen.push('a'));
		seen.push('after');
		expect(seen).toEqual(['a', 'after']);
	});

	it('runs an event posted during a turn after it, never inside it', () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		box.post(() => {
			seen.push('a starts');
			box.post(() => seen.push('b'));
			seen.push('a ends');
		});
		expect(seen).toEqual(['a starts', 'a ends', 'b']);
	});

	it('lets the next event in while a handler waits, and gives it its turn back behind it', async () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		const done = box.ask(async (turn) => {
			seen.push('a starts');
			const v = await turn.wait(later('x'));
			seen.push(`a back with ${String(v)}`);
		});
		box.post(() => seen.push('b'));
		expect(seen).toEqual(['a starts', 'b']);
		await done;
		expect(seen).toEqual(['a starts', 'b', 'a back with x']);
	});

	it('holds the turn across a plain await: nothing else runs until the handler is back', async () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		const done = box.ask(async () => {
			seen.push('a starts');
			await later(null);
			seen.push('a ends');
		});
		box.post(() => seen.push('b'));
		expect(seen).toEqual(['a starts']);
		await done;
		await Promise.resolve();
		expect(seen).toEqual(['a starts', 'a ends', 'b']);
	});

	it('gives a handler coming back from its wait no turn while another holds one', async () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		const a = box.ask(async (turn) => {
			await turn.wait(Promise.resolve());
			seen.push('a back');
		});
		const b = box.ask(async () => {
			seen.push('b holds');
			await gate; // (a plain await: b keeps the turn)
			seen.push('b ends');
		});
		await later(null);
		expect(seen).toEqual(['b holds']);
		open();
		await Promise.all([a, b]);
		expect(seen).toEqual(['b holds', 'b ends', 'a back']);
	});

	it('ends with its owner: queued events are dropped, a wait is STALE at once, later posts too', async () => {
		const life = scope();
		const box = mailbox(life);
		const seen: string[] = [];
		let waited: unknown;
		const forever = new Promise<never>(() => {});
		const a = box.ask(async (turn: Turn) => {
			box.post(() => seen.push('queued'));
			waited = await turn.wait(forever);
			seen.push('a back');
			return turn.wait(Promise.resolve('again'));
		});
		const b = box.ask(async (turn) => {
			// (b got its turn while a waits; it waits too)
			return turn.wait(forever);
		});
		expect(seen).toEqual(['queued']);
		life.close();
		expect(await a).toBe(STALE);
		expect(await b).toBe(STALE);
		expect(waited).toBe(STALE);
		expect(box.closed).toBe(true);
		box.post(() => seen.push('after'));
		expect(await box.ask(() => 'never')).toBe(STALE);
		expect(seen).toEqual(['queued', 'a back']);
	});

	it('tells an asker whose event was dropped STALE', async () => {
		const life = scope();
		const box = mailbox(life);
		const first = box.ask((turn) => turn.wait(new Promise<never>(() => {})));
		// (the first waits, so the box is free: a second handler that holds its turn)
		let hold!: () => void;
		const held = box.ask(() => new Promise<void>((r) => (hold = r)));
		const dropped = box.ask(() => 'never');
		life.close();
		expect(await first).toBe(STALE);
		expect(await dropped).toBe(STALE);
		hold();
		await held;
	});

	it('throws a handler’s failure to its asker, and a wait’s rejection back in the turn', async () => {
		const box = mailbox(scope());
		await expect(
			box.ask(() => {
				throw new Error('sync');
			})
		).rejects.toThrow('sync');
		await expect(
			box.ask(async (turn) => {
				try {
					await turn.wait(Promise.reject(new Error('net')));
				} catch (error) {
					return `caught ${(error as Error).message}`;
				}
			})
		).resolves.toBe('caught net');
		// the box goes on
		const seen: string[] = [];
		box.post(() => seen.push('next'));
		expect(seen).toEqual(['next']);
	});

	it('reports a queued handler that throws, and goes on with the next', () => {
		const report = vi.fn();
		vi.stubGlobal('reportError', report);
		try {
			const box = mailbox(scope());
			const seen: string[] = [];
			box.post(() => {
				box.post(() => {
					throw new Error('queued');
				});
				box.post(() => seen.push('after'));
			});
			expect(report).toHaveBeenCalledOnce();
			expect(String(report.mock.calls[0][0])).toContain('queued');
			expect(seen).toEqual(['after']);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('throws a sync failure to its poster when it runs at once', () => {
		const box = mailbox(scope());
		expect(() =>
			box.post(() => {
				throw new Error('direct');
			})
		).toThrow('direct');
		const seen: string[] = [];
		box.post(() => seen.push('next'));
		expect(seen).toEqual(['next']);
	});

	it('is closed for an owner already closed', async () => {
		const life = scope();
		life.close();
		expect(mailbox(life)).toBe(CLOSED_BOX);
		expect(await CLOSED_BOX.wait(Promise.resolve(1))).toBe(STALE);
	});

	it('a wait whose work settled while another handler held the turn hears STALE when the box closes', async () => {
		const life = scope();
		const box = mailbox(life);
		let release!: () => void;
		const work = new Promise<string>((r) => (release = () => r('x')));
		// b waits; a then takes the turn and holds it on a plain await
		const b = box.ask((turn) => turn.wait(work));
		box.post(async () => {
			await new Promise(() => {});
		});
		// b's work settles while a holds the turn: b's return queues behind a
		release();
		await later(null);
		// the element leaves before a lets the turn go
		life.close();
		expect(await Promise.race([b, later('never settled', 50)])).toBe(STALE);
	});
});
