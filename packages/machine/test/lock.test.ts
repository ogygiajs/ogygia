import { describe, expect, it } from 'vitest';
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

	it('random runs: never two owners, never a lost waiter', async () => {
		let seed = 7;
		const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
		for (let round = 0; round < 300; round++) {
			const l = lock();
			const owners = new Set<LockToken>();
			const waiting: Promise<void>[] = [];
			let granted = 0;
			let asked = 0;
			let aborted = 0;
			for (let op = 0; op < 40; op++) {
				const r = rand();
				if (r < 0.3) {
					const t = l.take();
					if (t !== null) {
						expect(owners.size).toBe(0);
						owners.add(t);
					}
				} else if (r < 0.6) {
					asked++;
					const ctl = new AbortController();
					waiting.push(
						l.acquire(ctl.signal).then(
							(t) => {
								expect(owners.size).toBe(0);
								owners.add(t);
								granted++;
							},
							() => void aborted++
						)
					);
					if (rand() < 0.3) ctl.abort();
				} else {
					for (const t of owners) {
						expect(l.free(t)).toBe(true);
						owners.delete(t);
					}
					await Promise.resolve();
				}
				expect(l.held).toBe(owners.size > 0 || l.held);
			}
			// drain: free until every waiter has had its turn
			for (let i = 0; i < 200 && granted + aborted < asked; i++) {
				for (const t of owners) {
					l.free(t);
					owners.delete(t);
				}
				await macrotask();
			}
			expect(granted + aborted).toBe(asked);
		}
	});
});
