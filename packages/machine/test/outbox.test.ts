import { afterEach, describe, expect, it, vi } from 'vitest';
import { outbox, policy, STALE, type Policy } from '../src/index.ts';
import { backoffAfter, under_policy } from '../src/policy.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quick tries for a test: real timers, short waits, no spread. */
const quick = (p: Partial<Policy> = {}): Policy =>
	policy({ attempts: 3, backoff: 10, jitter: 0, deadline: 2000, ...p });

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** The fake clock: timers and `performance.now()` move only as a test advances them. */
const fake_clock = () =>
	vi.useFakeTimers({
		toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date']
	});

/** Whether `p` has settled, read after the microtasks queued so far have run. */
async function settled(p: Promise<unknown>): Promise<boolean> {
	let done = false;
	void p.then(
		() => (done = true),
		() => (done = true)
	);
	for (let i = 0; i < 20; i++) await Promise.resolve();
	return done;
}

describe('put', () => {
	it('returns at once, never throws, and resolves true once the send is done', async () => {
		let applied = 0;
		let release!: () => void;
		const answered = new Promise<void>((r) => (release = r));
		const box = outbox({
			send: async (n: number) => {
				await answered;
				applied += n;
			},
			retry: quick()
		});
		const sent = box.put(2);
		expect(sent).toBeInstanceOf(Promise);
		expect(await settled(sent)).toBe(false);
		expect(applied).toBe(0);
		release();
		expect(await sent).toBe(true);
		expect(applied).toBe(2);
	});

	it('tries a failed send again after its backoff, until one is done', async () => {
		fake_clock();
		const at: number[] = [];
		const box = outbox({
			send: () => {
				at.push(performance.now());
				if (at.length < 3) throw new Error('not yet');
			},
			retry: quick({ attempts: 4, backoff: [30, 60] })
		});
		const sent = box.put('x');
		await vi.advanceTimersByTimeAsync(29);
		expect(at).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(at).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(59);
		expect(at).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(await sent).toBe(true);
		expect(at).toHaveLength(3);
		expect([at[1] - at[0], at[2] - at[1]]).toEqual([30, 60]);
	});

	it('out of tries: giveUp hears the last error once, and the put resolves false', async () => {
		const give_up = vi.fn();
		let n = 0;
		const box = outbox({
			send: async () => {
				throw new Error(`down ${++n}`);
			},
			retry: quick({ attempts: 3 }),
			giveUp: give_up
		});
		expect(await box.put('notice')).toBe(false);
		expect(n).toBe(3);
		expect(give_up).toHaveBeenCalledOnce();
		expect(give_up.mock.calls[0][0]).toBe('notice');
		expect((give_up.mock.calls[0][1] as Error).message).toBe('down 3');
	});

	it('with no giveUp, a send given up is printed once with its code', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const box = outbox({
			name: 'pings',
			send: () => Promise.reject(new Error('down')),
			retry: quick({ attempts: 2 })
		});
		expect(await box.put(1)).toBe(false);
		expect(error).toHaveBeenCalledOnce();
		expect(String(error.mock.calls[0][0])).toContain('machine_outbox_gave_up');
		expect(String(error.mock.calls[0][0])).toContain('pings');
	});

	it('the deadline aborts the try still out, and no try starts after it', async () => {
		fake_clock();
		const give_up = vi.fn();
		const signals: AbortSignal[] = [];
		const box = outbox({
			// a receiver that never answers
			send: (_: number, signal) => {
				signals.push(signal);
				return new Promise(() => {});
			},
			retry: quick({ attempts: 5, deadline: 60 }),
			giveUp: give_up
		});
		const sent = box.put(1);
		await vi.advanceTimersByTimeAsync(59);
		expect(await settled(sent)).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(await sent).toBe(false);
		expect(signals).toHaveLength(1);
		expect(signals[0].aborted).toBe(true);
		expect((give_up.mock.calls[0][1] as DOMException).name).toBe('TimeoutError');
	});

	it('gives up at once when the next wait would end past the deadline', async () => {
		let n = 0;
		const box = outbox({
			send: () => {
				n++;
				throw new Error('down');
			},
			retry: quick({ attempts: 5, backoff: 500, deadline: 100 }),
			giveUp: () => {}
		});
		fake_clock();
		const sent = box.put(1);
		expect(await settled(sent)).toBe(true);
		expect(await sent).toBe(false);
		expect(n).toBe(1);
	});

	it('a send that throws before it returns is a failed try like any other', async () => {
		let n = 0;
		const box = outbox({
			send: () => {
				if (++n === 1) throw new Error('sync');
				return 'ok';
			},
			retry: quick()
		});
		expect(await box.put(1)).toBe(true);
		expect(n).toBe(2);
	});

	it('an id that throws: not sent, said, and put still never throws', async () => {
		const give_up = vi.fn();
		const send = vi.fn();
		const box = outbox<{ id?: string }>({
			send,
			id: (x) => {
				if (!x.id) throw new Error('no id');
				return x.id;
			},
			giveUp: give_up
		});
		expect(await box.put({})).toBe(false);
		expect(send).not.toHaveBeenCalled();
		expect(give_up).toHaveBeenCalledOnce();
	});

	it('an id that is not a string or a finite number names nothing: not sent, said, false (#350)', async () => {
		const give_up = vi.fn();
		const send = vi.fn(() => wait(10));
		const box = outbox<{ id?: unknown }>({
			send,
			id: (x) => x.id as string,
			giveUp: give_up
		});
		// (each would have joined the first one's send while it was out)
		const puts = [box.put({}), box.put({}), box.put({ id: NaN }), box.put({ id: Infinity })];
		const good = box.put({ id: 'a' });
		expect(await Promise.all(puts)).toEqual([false, false, false, false]);
		expect(await good).toBe(true);
		expect(send).toHaveBeenCalledOnce();
		expect(give_up).toHaveBeenCalledTimes(4);
		expect(String(give_up.mock.calls[0][1])).toContain('machine_bad_option');
	});

	it('ids 1 and "1" are two sends', async () => {
		const send = vi.fn(() => wait(5));
		const box = outbox<{ id: string | number }>({ send, id: (x) => x.id });
		await Promise.all([box.put({ id: 1 }), box.put({ id: '1' }), box.put({ id: 1 })]);
		expect(send).toHaveBeenCalledTimes(2);
	});

	it('a giveUp that throws is printed with the code', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const box = outbox({
			send: () => Promise.reject(new Error('down')),
			retry: quick({ attempts: 1 }),
			giveUp: () => {
				throw new Error('giveUp broke');
			}
		});
		expect(await box.put(1)).toBe(false);
		expect(String(error.mock.calls[0][0])).toContain('machine_outbox_gave_up');
		expect((error.mock.calls[0][1] as Error).message).toBe('giveUp broke');
	});
});

describe('waitUntil', () => {
	it('is handed each send, which settles when the send ends', async () => {
		const kept: Promise<unknown>[] = [];
		let applied = false;
		const box = outbox({
			send: async () => {
				await wait(20);
				applied = true;
			},
			retry: quick(),
			waitUntil: (work) => kept.push(work)
		});
		const sent = box.put(1);
		expect(kept).toEqual([sent]);
		expect(applied).toBe(false);
		await kept[0];
		expect(applied).toBe(true);
	});

	it('puts that join one send each hand it over, and each settles when that one send ends', async () => {
		const kept: Promise<unknown>[] = [];
		const send = vi.fn(() => wait(20));
		const box = outbox({
			send,
			id: (n: { id: string }) => n.id,
			retry: quick(),
			waitUntil: (work) => kept.push(work)
		});
		const first = box.put({ id: 'x' });
		const joined = box.put({ id: 'x' });
		expect(kept).toEqual([first, joined]);
		expect(await Promise.all(kept)).toEqual([true, true]);
		expect(send).toHaveBeenCalledOnce();
	});

	it('a platform that refuses it does not stop the send, and put does not throw', async () => {
		const send = vi.fn();
		const box = outbox({
			send,
			retry: quick(),
			waitUntil: () => {
				throw new Error('closed');
			}
		});
		expect(await box.put(1)).toBe(true);
		expect(send).toHaveBeenCalledOnce();
	});
});

describe('id', () => {
	it('a put of an id still out joins it: one send', async () => {
		const send = vi.fn(() => wait(20));
		const box = outbox({ send, id: (n: { id: string }) => n.id, retry: quick() });
		const a = box.put({ id: 'n1' });
		const b = box.put({ id: 'n1' });
		const c = box.put({ id: 'n2' });
		expect(await Promise.all([a, b, c])).toEqual([true, true, true]);
		expect(send).toHaveBeenCalledTimes(2);
		// done: a later put of the id is a new send (the receiver drops the copy)
		expect(await box.put({ id: 'n1' })).toBe(true);
		expect(send).toHaveBeenCalledTimes(3);
	});

	it('done means applied: an answer lost after the apply is sent again, and the receiver drops the copy', async () => {
		// the receiver: applies first, records the id after, drops an id it recorded
		const recorded = new Set<string>();
		let applied = 0;
		let lose_answer = true;
		const receive = async (n: { id: string }): Promise<{ ok: boolean }> => {
			await wait(5);
			if (recorded.has(n.id)) return { ok: true };
			applied++;
			recorded.add(n.id);
			return { ok: true };
		};
		const box = outbox({
			send: async (n: { id: string }) => {
				const answer = await receive(n);
				// the connection drops after the receiver applied it: no answer reaches the sender
				if (lose_answer) {
					lose_answer = false;
					throw new Error('connection reset');
				}
				if (!answer.ok) throw new Error('not applied');
			},
			id: (n) => n.id,
			retry: quick()
		});
		expect(await box.put({ id: 'thaw-1' })).toBe(true);
		expect(applied).toBe(1);
	});

	it('a receiver that failed to apply is tried again until it applies', async () => {
		let store_up = false;
		let applied = 0;
		const box = outbox({
			send: async () => {
				const ok = store_up;
				store_up = true;
				if (!ok) throw new Error('503 not applied');
				applied++;
			},
			id: () => 'one',
			retry: quick()
		});
		expect(await box.put(1)).toBe(true);
		expect(applied).toBe(1);
	});
});

describe('inOrder', () => {
	it('a put of an id still queued joins it: one send, in its place in line', async () => {
		const seen: string[] = [];
		const box = outbox<{ id: string; v: number }>({
			send: async (x) => {
				seen.push(`${x.id}${x.v}`);
				await wait(10);
			},
			id: (x) => x.id,
			retry: quick(),
			inOrder: true
		});
		const a = box.put({ id: 'a', v: 1 }); // (out)
		const b = box.put({ id: 'b', v: 1 }); // (queued behind a)
		const b_again = box.put({ id: 'b', v: 2 }); // (joins the queued b: the first put is the one sent)
		const c = box.put({ id: 'c', v: 1 });
		expect(await Promise.all([a, b, b_again, c])).toEqual([true, true, true, true]);
		expect(seen).toEqual(['a1', 'b1', 'c1']);
	});

	it('one send at a time, in put order, a failing one tried again before the next goes', async () => {
		const seen: string[] = [];
		let first_fails = true;
		let out = 0;
		let most = 0;
		const box = outbox({
			send: async (s: string) => {
				out++;
				most = Math.max(most, out);
				await wait(5);
				out--;
				if (s === 'a' && first_fails) {
					first_fails = false;
					throw new Error('blip');
				}
				seen.push(s);
			},
			retry: quick(),
			inOrder: true
		});
		const all = await Promise.all([box.put('a'), box.put('b'), box.put('c')]);
		expect(all).toEqual([true, true, true]);
		expect(seen).toEqual(['a', 'b', 'c']);
		expect(most).toBe(1);
	});

	it('with none ahead, the send starts inside the put; behind one, once it ends', async () => {
		const started: number[] = [];
		const box = outbox({
			send: (n: number) => {
				started.push(n);
				return wait(10);
			},
			retry: quick(),
			inOrder: true
		});
		const a = box.put(1);
		expect(started).toEqual([1]);
		const b = box.put(2);
		expect(started).toEqual([1]);
		await a;
		await b;
		expect(started).toEqual([1, 2]);
		void box.put(3);
		expect(started).toEqual([1, 2, 3]); // (none ahead again)
	});

	it('one given up does not stop the ones after it', async () => {
		const seen: string[] = [];
		const box = outbox({
			send: async (s: string) => {
				if (s === 'a') throw new Error('down');
				seen.push(s);
			},
			retry: quick({ attempts: 2 }),
			inOrder: true,
			giveUp: () => {}
		});
		expect(await Promise.all([box.put('a'), box.put('b')])).toEqual([false, true]);
		expect(seen).toEqual(['b']);
	});

	it('the deadline counts from its own turn, not from the put', async () => {
		const box = outbox({
			send: (ms: number) => wait(ms),
			retry: quick({ attempts: 1, deadline: 80 }),
			inOrder: true,
			giveUp: () => {}
		});
		// each takes 50 ms: the second waits 50 ms for its turn, then has its own 80
		expect(await Promise.all([box.put(50), box.put(50)])).toEqual([true, true]);
	});

	it('sends go out together without it', async () => {
		let out = 0;
		let most = 0;
		const box = outbox({
			send: async () => {
				out++;
				most = Math.max(most, out);
				await wait(10);
				out--;
			},
			retry: quick()
		});
		await Promise.all([box.put(1), box.put(2), box.put(3)]);
		expect(most).toBe(3);
	});
});

describe('policy', () => {
	it('fills what it leaves out from the standard one, and is frozen', () => {
		const p = policy({ attempts: 2 });
		expect(p).toEqual({ ...policy.standard, attempts: 2 });
		expect(Object.isFrozen(p)).toBe(true);
		expect(Object.isFrozen(p.backoff)).toBe(true);
		expect(policy.standard.attempts).toBe(4);
	});

	it('refuses numbers it cannot use, where they are written', () => {
		expect(() => policy({ attempts: 0 })).toThrow(/machine_bad_option/);
		expect(() => policy({ attempts: 1.5 })).toThrow(/attempts/);
		expect(() => policy({ backoff: -1 })).toThrow(/backoff/);
		expect(() => policy({ backoff: [] })).toThrow(/backoff/);
		expect(() => policy({ backoff: [10, Number.NaN] })).toThrow(/backoff/);
		expect(() => policy({ jitter: 2 })).toThrow(/jitter/);
		expect(() => policy({ deadline: 0 })).toThrow(/deadline/);
		expect(() => policy({ deadline: 2 ** 40 })).toThrow(/deadline/);
		expect(policy({ deadline: Infinity }).deadline).toBe(Infinity);
	});

	it('a run that answered leaves no timer behind, not even its deadline’s', async () => {
		vi.useFakeTimers();
		try {
			const p = policy({ attempts: 1, deadline: 60_000 });
			expect(await under_policy(p, () => 'ok')).toBe('ok');
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('takes the longest wait a timer can hold, and no longer', () => {
		const most = 2_147_483_647;
		expect(policy({ backoff: most }).backoff).toBe(most);
		expect(policy({ deadline: most }).deadline).toBe(most);
		expect(() => policy({ backoff: most + 1 })).toThrow(/backoff/);
	});

	it('a list backs off by its entries (the last repeats); a number doubles', () => {
		const list = policy({ backoff: [200, 1000], jitter: 0 });
		expect([1, 2, 3, 4].map((n) => backoffAfter(list, n))).toEqual([200, 1000, 1000, 1000]);
		const doubling = policy({ backoff: 100, jitter: 0 });
		expect([1, 2, 3].map((n) => backoffAfter(doubling, n))).toEqual([100, 200, 400]);
	});

	it('jitter cuts a wait by up to its share', () => {
		const p = policy({ backoff: [1000], jitter: 0.5 });
		expect(backoffAfter(p, 1, 0)).toBe(1000);
		expect(backoffAfter(p, 1, 1)).toBe(500);
		expect(backoffAfter(p, 1, 0.5)).toBe(750);
	});

	it('a wait is always a number of 0 to the timer limit: before the first try, and after very many (#359)', () => {
		const list = policy({ backoff: [200, 1000], jitter: 0 });
		const doubling = policy({ backoff: 100, jitter: 0 });
		const none = policy({ backoff: 0, jitter: 0 });
		// (a count from 0: the first wait, as for 1)
		expect(backoffAfter(list, 0)).toBe(200);
		expect(backoffAfter(doubling, 0)).toBe(100);
		// (2^5000 is Infinity: capped, and 0 stays 0, never 0 * Infinity)
		expect(backoffAfter(doubling, 5000)).toBe(2_147_483_647);
		expect(backoffAfter(none, 5000)).toBe(0);
		// jitter 1 can cut a wait to nothing, never below
		expect(backoffAfter(policy({ backoff: [1000], jitter: 1 }), 1, 1)).toBe(0);
	});

	it('out of time before the next wait ends is a TimeoutError with the last error in it (#359)', async () => {
		const p = quick({ attempts: 5, backoff: 500, deadline: 100 });
		const error = await under_policy(p, () => Promise.reject(new Error('down'))).catch((e) => e);
		expect((error as DOMException).name).toBe('TimeoutError');
		expect((error as DOMException).message).toContain('down');
	});

	it('the caller leaving and the deadline in the same turn: whichever came first says how it ended', async () => {
		const p = quick({ attempts: 1, deadline: 20 });
		const never = () => new Promise<never>(() => {});
		// the caller's abort first (its timer was set before the deadline's)
		const first = new AbortController();
		setTimeout(() => first.abort(), 20);
		await expect(under_policy(p, never, first.signal)).resolves.toBe(STALE);
		// the deadline first (the caller's timer set after it, for the same moment)
		const second = new AbortController();
		const out = under_policy(p, never, second.signal);
		setTimeout(() => second.abort(), 20);
		const error = await out.catch((e) => e);
		expect((error as DOMException).name).toBe('TimeoutError');
	});

	it('the outbox refuses a send that is not a function', () => {
		expect(() => outbox({ send: 1 as never })).toThrow(/machine_bad_option/);
	});
});
