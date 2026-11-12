import { describe, expect, it, vi } from 'vitest';
import { lock, type LockToken } from '../src/index.ts';
import { macrotask } from './_tick.ts';

describe('lock', () => {
	it('take: one owner at a time', () => {
		const l = lock();
		expect(l.held).toBe(false);
		const t = l.take();
		expect(t).not.toBe(null);
		expect(l.held).toBe(true);
		expect(l.take()).toBe(null);
		expect(l.free(t as LockToken)).toBe(true);
		expect(l.held).toBe(false);
	});

	it('only the token that holds it frees it', () => {
		const l = lock();
		const first = l.take() as LockToken;
		l.free(first);
		const second = l.take() as LockToken;
		expect(l.free(first)).toBe(false); // a late free from an old owner
		expect(l.held).toBe(true);
		expect(l.free(second)).toBe(true);
	});

	it('freeing twice does nothing the second time', () => {
		const l = lock();
		const t = l.take() as LockToken;
		expect(l.free(t)).toBe(true);
		expect(l.free(t)).toBe(false);
		const next = l.take() as LockToken;
		expect(l.free(t)).toBe(false);
		expect(l.held).toBe(true);
		l.free(next);
	});

	it('a free lock refuses any free', () => {
		expect(lock().free(1 as LockToken)).toBe(false);
	});

	it('every take gets a new token', () => {
		const l = lock();
		const a = l.take() as LockToken;
		l.free(a);
		const b = l.take() as LockToken;
		expect(b).not.toBe(a);
	});

	it('acquire: at once when free', async () => {
		const l = lock();
		const t = await l.acquire();
		expect(l.held).toBe(true);
		expect(l.free(t)).toBe(true);
	});

	it('acquire: waits its turn, first come first served, handed straight on', async () => {
		const l = lock();
		const first = l.take() as LockToken;
		const order: string[] = [];
		const a = l.acquire().then((t) => (order.push('a'), t));
		const b = l.acquire().then((t) => (order.push('b'), t));
		expect(l.take()).toBe(null); // nobody barges in while others wait
		l.free(first);
		expect(l.held).toBe(true); // handed straight to `a`: never free in between
		expect(l.take()).toBe(null);
		const ta = await a;
		l.free(ta);
		const tb = await b;
		expect(order).toEqual(['a', 'b']);
		expect(l.free(tb)).toBe(true);
		expect(l.held).toBe(false);
	});

	it('acquire: an abort before its turn leaves the queue and rejects with the reason', async () => {
		const l = lock();
		const held = l.take() as LockToken;
		const ctl = new AbortController();
		const a = l.acquire(ctl.signal);
		const b = l.acquire();
		ctl.abort(new Error('gave up'));
		await expect(a).rejects.toThrow('gave up');
		l.free(held);
		const tb = await b; // `b` is next, `a` is gone
		expect(l.free(tb)).toBe(true);
		expect(l.held).toBe(false);
	});

	it('acquire: an already aborted signal rejects at once and never takes it', async () => {
		const l = lock();
		const ctl = new AbortController();
		ctl.abort(new Error('already'));
		await expect(l.acquire(ctl.signal)).rejects.toThrow('already');
		expect(l.held).toBe(false);
	});

	it('acquire: an abort after its turn changes nothing', async () => {
		const l = lock();
		const held = l.take() as LockToken;
		const ctl = new AbortController();
		const a = l.acquire(ctl.signal);
		l.free(held);
		const t = await a;
		ctl.abort();
		expect(l.held).toBe(true);
		expect(l.free(t)).toBe(true);
	});

	it('acquire: a waiter handed the lock lets go of its abort listener (a long-lived signal does not pile them up)', async () => {
		const l = lock();
		const ctl = new AbortController();
		const removed = vi.spyOn(ctl.signal, 'removeEventListener');
		const held = l.take() as LockToken;
		const a = l.acquire(ctl.signal);
		l.free(held);
		l.free(await a);
		expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
	});

	it('seize: takes it from a stuck owner, whose late free is then refused', async () => {
		const l = lock();
		const stuck = l.take() as LockToken;
		const waiter = l.acquire();
		const mine = l.seize();
		expect(l.free(stuck)).toBe(false); // the orphan's finally cannot free the new run
		expect(l.held).toBe(true);
		l.free(mine);
		const next = await waiter; // waiters keep their place
		expect(l.free(next)).toBe(true);
		expect(l.held).toBe(false);
	});

	it('random runs agree with a model: one owner, exact held, first come first served', async () => {
		let seed = 7;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		for (let round = 0; round < 300; round++) {
			const l = lock();
			// the model. A token is "handed" from the moment the lock gives it (synchronously, in
			// `free` or `acquire`) until its owner's promise callback receives it: the lock is held
			// all that time, though no owner holds the token yet.
			type Waiter = { id: number; outcome: 'waiting' | 'handed' | 'owner' | 'aborted' };
			const owners = new Set<LockToken>();
			const queue: Waiter[] = []; // still waiting, in the order asked
			const waiters: Waiter[] = [];
			const received: number[] = []; // waiter ids, in the order they received the lock
			const handed_order: number[] = []; // waiter ids, in the order the model hands it on
			let handed = 0;
			const held = () => owners.size > 0 || handed > 0;
			const hand_on = () => {
				const next = queue.shift();
				if (next === undefined) return;
				next.outcome = 'handed';
				handed++;
				handed_order.push(next.id);
			};
			for (let op = 0; op < 40; op++) {
				const r = rand();
				if (r < 0.3) {
					const t = l.take();
					expect(t === null).toBe(held()); // takes it exactly when the model says it is free
					if (t !== null) owners.add(t);
				} else if (r < 0.6) {
					const w: Waiter = { id: waiters.length, outcome: 'waiting' };
					waiters.push(w);
					if (held()) queue.push(w);
					else {
						w.outcome = 'handed';
						handed++;
						handed_order.push(w.id);
					}
					const ctl = new AbortController();
					void l.acquire(ctl.signal).then(
						(t) => {
							expect(w.outcome).toBe('handed');
							w.outcome = 'owner';
							handed--;
							owners.add(t);
							received.push(w.id);
						},
						() => expect(w.outcome).toBe('aborted')
					);
					if (rand() < 0.3) {
						ctl.abort();
						// an abort before its turn leaves the queue; after it, it changes nothing
						const at = queue.indexOf(w);
						if (at !== -1) {
							queue.splice(at, 1);
							w.outcome = 'aborted';
						}
					}
				} else if (r < 0.85) {
					for (const t of owners) {
						expect(l.free(t)).toBe(true);
						owners.delete(t);
						hand_on();
					}
				} else {
					await macrotask(); // handed tokens reach their owners
				}
				expect(owners.size).toBeLessThanOrEqual(1);
				expect(owners.size + handed).toBeLessThanOrEqual(1);
				expect(l.held).toBe(held());
			}
			// drain: free until every waiter has had its turn
			for (let i = 0; i < 400 && (queue.length > 0 || handed > 0 || owners.size > 0); i++) {
				for (const t of owners) {
					expect(l.free(t)).toBe(true);
					owners.delete(t);
					hand_on();
				}
				await macrotask();
			}
			expect(waiters.every((w) => w.outcome === 'owner' || w.outcome === 'aborted')).toBe(true);
			expect(received).toEqual(handed_order);
			expect(l.held).toBe(false);
		}
	});
});
