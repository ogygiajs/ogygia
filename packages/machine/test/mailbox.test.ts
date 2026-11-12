// A MAILBOX (src/mailbox.ts; a region element's, #322): its events one at a time, in the order they
// came; a wait lets the next one in and comes back behind it; the owner closing drops what is queued
// and ends every wait with STALE at once. Real timers, in node and in a real browser.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailbox, scope, STALE, type Turn } from '../src/index.ts';

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

	it('runs events in the order they were posted, across waits', async () => {
		const box = mailbox(scope());
		const seen: number[] = [];
		const asks: Promise<unknown>[] = [];
		for (let i = 0; i < 5; i++)
			asks.push(
				box.ask(async (turn) => {
					seen.push(i);
					await turn.wait(later(null, 5 - i));
					seen.push(10 + i);
				})
			);
		await Promise.all(asks);
		// (each started in order; each came back once its own wait settled and the turn was free)
		expect(seen.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
		expect(seen.slice(5).sort()).toEqual([10, 11, 12, 13, 14]);
	});

	it('ask() gives the handler’s value, sync or async, in its turn', async () => {
		const box = mailbox(scope());
		expect(await box.ask(() => 1)).toBe(1);
		expect(await box.ask(async (turn) => String(await turn.wait(later('two'))) + '!')).toBe('two!');
		const seen: string[] = [];
		box.post(async (turn) => {
			seen.push('a');
			await turn.wait(later(null, 5));
			seen.push('a back');
		});
		// (asked while a waits: it runs in the turn a let go)
		expect(await box.ask(() => (seen.push('asked'), seen.length))).toBe(2);
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

	it('a queued ask that has run leaves the wait list, so a long-lived box does not grow (#564)', async () => {
		const box = mailbox(scope());
		for (let i = 0; i < 100; i++) {
			let release!: () => void;
			// (held on a plain await, not turn.wait: the ask below is queued, not started)
			box.post(async () => {
				await new Promise<void>((r) => (release = r));
			});
			const asked = box.ask(() => i);
			release();
			expect(await asked).toBe(i);
			await later(null, 0);
		}
		// (an internal look: the list holds only the waits still out)
		expect((box as unknown as { _waiting: Set<unknown> | null })._waiting?.size ?? 0).toBe(0);
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
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
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
			expect(String(said.mock.calls[0][0])).toContain('machine_mailbox_handler_failed');
			expect(seen).toEqual(['after']);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('with no page error handler, a queued handler’s throw follows its code', () => {
		vi.stubGlobal('reportError', undefined);
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const box = mailbox(scope());
			box.post(() => {
				box.post(() => {
					throw new Error('queued');
				});
			});
			expect(said).toHaveBeenCalledOnce();
			expect(String(said.mock.calls[0][0])).toContain('machine_mailbox_handler_failed');
			expect(String(said.mock.calls[0][1])).toContain('queued');
		} finally {
			vi.unstubAllGlobals();
		}
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

	it('a handler waiting on two things at once lets one event in, not two at once (#341)', async () => {
		const box = mailbox(scope());
		let on = 0;
		let most = 0;
		const busy = async () => {
			most = Math.max(most, ++on);
			await later(null, 20);
			on--;
		};
		const a = box.ask(async (turn) => {
			box.post(busy);
			box.post(busy);
			await Promise.all([turn.wait(later(1, 5)), turn.wait(later(2, 5))]);
			// (back in its turn: nothing else of the element runs beside it)
			most = Math.max(most, ++on);
			on--;
		});
		await a;
		await later(null, 60);
		expect(most).toBe(1);
	});

	it('a wait from outside any turn ends nobody’s turn (#341)', async () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		const a = box.ask(async () => {
			seen.push('a holds');
			await gate; // (a plain await: a keeps its turn)
			seen.push('a ends');
		});
		box.post(() => seen.push('b'));
		// (a callback that outlived its turn, or a caller with the box: not the one holding it)
		const outside = box.wait(later('x'));
		expect(seen).toEqual(['a holds']);
		expect(await outside).toBe('x');
		expect(seen).toEqual(['a holds']);
		open();
		await a;
		await Promise.resolve();
		expect(seen).toEqual(['a holds', 'a ends', 'b']);
	});

	it('a wait from a handler whose turn already ended ends nobody’s turn (#341)', async () => {
		const box = mailbox(scope());
		const seen: string[] = [];
		let late!: Turn;
		box.post((turn) => {
			late = turn; // (kept past its turn: a timer of the handler, say)
		});
		let open!: () => void;
		const gate = new Promise<void>((r) => (open = r));
		const b = box.ask(async () => {
			seen.push('b holds');
			await gate;
			seen.push('b ends');
		});
		box.post(() => seen.push('c'));
		expect(await late.wait(later('x'))).toBe('x');
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
		// (and the box is idle after: the next one runs at once)
		box.post(() => n++);
		expect(n).toBe(50_001);
	});

	it('work that settles after the box closed changes nothing: the box stays closed and idle', async () => {
		const life = scope();
		const box = mailbox(life);
		let done!: () => void;
		let failed!: (e: unknown) => void;
		const waits: Promise<unknown>[] = [];
		box.post((turn) => void waits.push(turn.wait(new Promise<void>((r) => (done = r)))));
		box.post((turn) => void waits.push(turn.wait(new Promise<void>((_, r) => (failed = r)))));
		life.close();
		done();
		failed(new Error('late'));
		expect(await Promise.all(waits)).toEqual([STALE, STALE]);
		const seen: string[] = [];
		box.post(() => seen.push('after'));
		expect(seen).toEqual([]);
		expect(await box.ask(() => 'never')).toBe(STALE);
	});

	it('a handler that never settles holds the box until its owner closes', async () => {
		const life = scope();
		const box = mailbox(life);
		box.post(() => new Promise<never>(() => {}));
		const next = vi.fn(() => 'ran');
		const asked = box.ask(next);
		await later(null, 10);
		expect(next).not.toHaveBeenCalled(); // (by design: a turn ends when its handler waits or ends)
		life.close();
		expect(await asked).toBe(STALE);
		expect(next).not.toHaveBeenCalled();
	});

	it('an ask whose handler waits, then sees its element leave: STALE for the asker too', async () => {
		const life = scope();
		const box = mailbox(life);
		const after = vi.fn();
		const asked = box.ask(async (turn) => {
			const v = await turn.wait(new Promise<never>(() => {}));
			if (v === STALE) return STALE;
			after();
			return 'on';
		});
		life.close();
		expect(await asked).toBe(STALE);
		expect(after).not.toHaveBeenCalled();
	});

	it('is closed for an owner already closed', async () => {
		const life = scope();
		life.close();
		const box = mailbox(life);
		expect(box.closed).toBe(true);
		expect(box).toBe(mailbox(life)); // (one closed box for every closed owner)
		expect(await box.wait(Promise.resolve(1))).toBe(STALE);
		expect(await box.ask(() => 1)).toBe(STALE);
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
