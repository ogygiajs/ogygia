import { afterEach, describe, expect, it, vi } from 'vitest';
import { observe, STALE } from '@ogygia/machine';
import * as frames from './_frames.ts';

afterEach(() => frames._reset());

/** A fetcher whose resolution you control, and that records whether it was aborted. */
function deferred(html = 'HTML') {
	let resolve!: (v: string) => void;
	let reject!: (e: unknown) => void;
	let aborted = false;
	const p = new Promise<string>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	const fetcher = (signal: AbortSignal) => {
		signal.addEventListener('abort', () => (aborted = true));
		return p;
	};
	return {
		fetcher,
		resolve: (v = html) => resolve(v),
		reject: (e: unknown = new Error('boom')) => reject(e),
		get aborted() {
			return aborted;
		}
	};
}

describe('frame-store: dedupe', () => {
	it('N callers on the same address share ONE fetch', async () => {
		const d = deferred('X');
		const spy = vi.fn(d.fetcher);
		const a = frames.ensure('/r?sig=1', spy);
		const b = frames.ensure('/r?sig=1', spy);
		const c = frames.ensure('/r?sig=1', spy);
		expect(spy).toHaveBeenCalledTimes(1);
		d.resolve('X');
		expect(await Promise.all([a, b, c])).toEqual(['X', 'X', 'X']);
	});

	it('different addresses fetch independently', () => {
		const spy = vi.fn(deferred().fetcher);
		frames.ensure('/r?sig=1', spy);
		frames.ensure('/r?sig=2', spy);
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('resolved content is reused without refetching', async () => {
		const d = deferred('ONE');
		const spy = vi.fn(d.fetcher);
		const first = frames.ensure('/r?sig=1', spy);
		d.resolve('ONE');
		await first;
		const again = await frames.ensure('/r?sig=1', vi.fn());
		expect(again).toBe('ONE');
		expect(spy).toHaveBeenCalledTimes(1);
	});
});

describe('frame-store: staleness', () => {
	it('drops a write older than what was applied', () => {
		expect(frames.write({ a: '/x', v: 5, html: 'new' })).toBe(true);
		expect(frames.write({ a: '/x', v: 3, html: 'old' })).toBe(false);
		expect(frames.peek('/x')).toEqual({ v: 5, html: 'new' });
	});

	it('a slow response that started earlier cannot overwrite a newer one', async () => {
		// Two forced fetches race; the SECOND to start gets the higher ticket and takes the place of
		// the first: the first is aborted, its caller joins the second, and a late answer of the first
		// (a fetcher that ignores its signal) is never written.
		const slow = deferred('SLOW-old');
		const fast = deferred('FAST-new');
		const pSlow = frames.ensure('/r?sig=1', slow.fetcher, { force: true }); // ticket 1
		const pFast = frames.ensure('/r?sig=1', fast.fetcher, { force: true }); // ticket 2
		expect(slow.aborted).toBe(true);
		fast.resolve('FAST-new'); // ticket 2 applies
		await pFast;
		expect(frames.peek('/r?sig=1')?.html).toBe('FAST-new');
		slow.resolve('SLOW-old'); // ticket 1 arrives late — dropped
		expect(await pSlow).toBe('FAST-new');
		expect(frames.peek('/r?sig=1')?.html).toBe('FAST-new');
	});
});

describe('frame-store: every answer at an address is a move', () => {
	/** The stored-answer moves heard while `run` writes, one line each. */
	function moves_of(run: () => void): string[] {
		const heard: string[] = [];
		const off = observe((name, from, to) => {
			if (name === 'stored-answer') heard.push(`${from.kind} -> ${to ? to.kind : 'stopped'}`);
		});
		try {
			run();
		} finally {
			off();
		}
		return heard;
	}

	it('an applied answer, a newer one, and each dropped one are moves of the address’s stored answer', () => {
		const heard = moves_of(() => {
			frames.write({ a: '/x', v: 1, html: 'a' });
			frames.write({ a: '/x', v: 2, html: 'b' });
			frames.write({ a: '/x', v: 1, html: 'older request' });
			frames.write({ a: '/x', v: 3, d: 5, html: 'c' });
			frames.write({ a: '/x', v: 4, d: 4, html: 'older data' });
		});
		expect(heard).toEqual([
			'empty -> shown',
			'shown -> shown',
			'shown -> kept',
			'kept -> shown',
			'shown -> kept'
		]);
		expect(frames.peek('/x')).toEqual({ v: 3, d: 5, html: 'c' });
	});

	it('a dropped answer’s move names what was dropped and why, and keeps what is shown', () => {
		const states: object[] = [];
		const off = observe((name, _from, to) => {
			if (name === 'stored-answer' && to) states.push(to);
		});
		frames.write({ a: '/y', v: 2, d: 7, html: 'shown' });
		frames.write({ a: '/y', v: 3, d: 6, html: 'older data' });
		frames.write({ a: '/y', v: 1, d: 7, html: 'older request' });
		off();
		expect(states).toEqual([
			{ kind: 'shown', v: 2, d: 7, html: 'shown' },
			{ kind: 'kept', v: 2, d: 7, html: 'shown', dropped: { v: 3, d: 6, why: 'older data' } },
			{ kind: 'kept', v: 2, d: 7, html: 'shown', dropped: { v: 1, d: 7, why: 'older request' } }
		]);
	});

	it('an address the store lets go ends its stored answer', () => {
		vi.useFakeTimers();
		try {
			const heard = moves_of(() => {
				frames.write({ a: '/gone', v: 1, html: 'x' });
				vi.advanceTimersByTime(60_000);
			});
			expect(heard).toEqual(['empty -> shown', 'shown -> stopped']);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('frame-store: lifecycle', () => {
	it('the fetch is aborted only when the LAST caller leaves', () => {
		const d = deferred();
		const a = new AbortController();
		const b = new AbortController();
		void frames.ensure('/r?sig=1', d.fetcher, { signal: a.signal });
		void frames.ensure('/r?sig=1', d.fetcher, { signal: b.signal }); // (deduped: one fetch)
		a.abort();
		expect(d.aborted).toBe(false); // one caller still there
		b.abort();
		expect(d.aborted).toBe(true); // last one out
	});

	it('a caller that leaves gets STALE at once; the others still get the answer', async () => {
		const d = deferred('X');
		const leave = new AbortController();
		const leaving = frames.ensure('/r?sig=1', d.fetcher, { signal: leave.signal });
		const staying = frames.ensure('/r?sig=1', d.fetcher, { signal: new AbortController().signal });
		leave.abort();
		expect(await leaving).toBe(STALE);
		d.resolve('X');
		expect(await staying).toBe('X');
	});

	it('a caller of a fetch that ended touches nothing newer at its address when it leaves', async () => {
		const first = deferred('ONE');
		const old = new AbortController();
		const failed = frames.ensure('/r?sig=1', first.fetcher, { signal: old.signal });
		first.reject(new Error('net'));
		await expect(failed).rejects.toThrow('net');
		const retry = deferred('TWO');
		const fresh = frames.ensure('/r?sig=1', retry.fetcher, {
			signal: new AbortController().signal
		});
		old.abort(); // (the copy that fetched first leaves)
		expect(retry.aborted).toBe(false);
		retry.resolve('TWO');
		expect(await fresh).toBe('TWO');
	});

	it('a forced fetch takes the place of the one out: its callers join the forced one', async () => {
		const older = deferred('OLD');
		const joined = frames.ensure('/r?sig=1', older.fetcher, {
			signal: new AbortController().signal
		});
		const forced = deferred('NEW');
		const refresh = frames.ensure('/r?sig=1', forced.fetcher, { force: true });
		expect(older.aborted).toBe(true); // (nobody waits on it any more)
		forced.resolve();
		expect(await refresh).toBe('NEW');
		expect(await joined).toBe('NEW');
	});

	it('a joiner of the forced fetch that leaves does not end it for its caller', async () => {
		const older = deferred();
		const leave = new AbortController();
		const joined = frames.ensure('/r?sig=1', older.fetcher, { signal: leave.signal });
		const forced = deferred('NEW');
		const refresh = frames.ensure('/r?sig=1', forced.fetcher, { force: true });
		await Promise.resolve(); // (the joiner of the older fetch moves onto the forced one)
		leave.abort();
		expect(await joined).toBe(STALE);
		expect(forced.aborted).toBe(false);
		forced.resolve();
		expect(await refresh).toBe('NEW');
	});

	it('a rejected fetch propagates to every joined caller and clears in-flight', async () => {
		const d = deferred();
		const a = frames.ensure('/r?sig=1', d.fetcher);
		const b = frames.ensure('/r?sig=1', d.fetcher);
		d.reject(new Error('net'));
		await expect(a).rejects.toThrow('net');
		await expect(b).rejects.toThrow('net');
		// A later ensure starts a fresh fetch (in-flight was cleared on failure).
		const spy = vi.fn(deferred('RETRY').fetcher);
		frames.ensure('/r?sig=1', spy);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('subscribers are notified on apply and stop after unsubscribe', () => {
		const seen: string[] = [];
		const off = frames.subscribe('/x', (f) => seen.push(f.html));
		frames.write({ a: '/x', v: 1, html: 'a' });
		frames.write({ a: '/x', v: 2, html: 'b' });
		off();
		frames.write({ a: '/x', v: 3, html: 'c' });
		expect(seen).toEqual(['a', 'b']);
	});
});

describe('frame-store: renewal', () => {
	it('a renewed capability is the address’s, for every element bound there', () => {
		expect(frames.renewal('id|p')).toBeNull();
		frames.renew('id|p', '/__ogygia__?id=id&props=p&exp=2&sig=new');
		expect(frames.renewal('id|p')).toBe('/__ogygia__?id=id&props=p&exp=2&sig=new');
		expect(frames.renewal('id|other')).toBeNull();
	});
});

describe('frame-store: eviction (no leak)', () => {
	afterEach(() => vi.useRealTimers());

	it('a write with NO subscriber evicts after the TTL (orphan writes do not leak)', () => {
		vi.useFakeTimers();
		// A single-flight mutation (or a live tick whose address changes) writes an address nothing is
		// bound to. It must not linger forever — nothing ever subscribes to trigger cleanup.
		frames.write({ a: '/orphan', v: 1, html: 'x' });
		expect(frames.peek('/orphan')).toEqual({ v: 1, html: 'x' }); // still here for a late binder
		vi.advanceTimersByTime(60_000);
		expect(frames.peek('/orphan')).toBeNull(); // dropped
	});

	it('a late binder within the TTL window still catches an unbound write (prefetch semantics)', () => {
		vi.useFakeTimers();
		frames.write({ a: '/warm', v: 1, html: 'seeded' });
		vi.advanceTimersByTime(30_000); // half the window
		const seen: string[] = [];
		frames.subscribe('/warm', (f) => seen.push(f.html)); // mounts late — replays current content
		expect(seen).toEqual(['seeded']);
		vi.advanceTimersByTime(60_000); // subscribing cancelled the evict; still held while bound
		expect(frames.peek('/warm')).toEqual({ v: 1, html: 'seeded' });
	});

	it('a subscribed address is NOT evicted by its own writes', () => {
		vi.useFakeTimers();
		frames.subscribe('/live', () => {});
		frames.write({ a: '/live', v: 1, html: 'a' });
		frames.write({ a: '/live', v: 2, html: 'b' });
		vi.advanceTimersByTime(120_000);
		expect(frames.peek('/live')).toEqual({ v: 2, html: 'b' }); // bound → kept
	});
});

describe('frame-store: reservation (single-flight navigation)', () => {
	it('ensure() JOINS a reservation instead of fetching; write() fulfils it', async () => {
		// A batch reserves the address before the binder connects. The binder's ensure() must NOT fetch.
		frames.reserve('/r?sig=1');
		const spy = vi.fn(deferred().fetcher);
		const joined = frames.ensure('/r?sig=1', spy);
		expect(spy).not.toHaveBeenCalled(); // joined the batch — no per-region fetch
		frames.write({ a: '/r?sig=1', v: 5, html: 'FROM-BATCH' }); // frame lands
		expect(await joined).toBe('FROM-BATCH');
		expect(frames.peek('/r?sig=1')).toEqual({ v: 5, html: 'FROM-BATCH' });
	});

	it('release() fails an undelivered reservation so the binder falls back to its own fetch', async () => {
		frames.reserve('/r?sig=1');
		const joined = frames.ensure('/r?sig=1', vi.fn());
		frames.release('/r?sig=1'); // batch ended, no frame for this address
		await expect(joined).rejects.toThrow(/no frame/);
		// A fresh ensure now starts a real fetch (reservation cleared).
		const spy = vi.fn(deferred('LATE').fetcher);
		frames.ensure('/r?sig=1', spy);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('the last joiner leaving a reservation lets it go, and a later binder still joins the batch', async () => {
		frames.reserve('/r?sig=1');
		const leave = new AbortController();
		const leaving = frames.ensure('/r?sig=1', vi.fn(), { signal: leave.signal });
		leave.abort();
		expect(await leaving).toBe(STALE);
		const spy = vi.fn(deferred().fetcher);
		const later = frames.ensure('/r?sig=1', spy);
		expect(spy).not.toHaveBeenCalled(); // the batch is still coming
		frames.write({ a: '/r?sig=1', v: 9, html: 'FROM-BATCH' });
		expect(await later).toBe('FROM-BATCH');
	});

	it('a forced fetch at a reserved address takes its place: the joiners wait on it, and the batch frame is what they get', async () => {
		frames.reserve('a');
		const joined = frames.ensure('a', deferred().fetcher);
		const forced = deferred('<p>refresh</p>');
		const refresh = frames.ensure('a', forced.fetcher, { force: true }); // a lake revalidates
		frames.write({ a: 'a', v: frames.ticket('a'), html: '<p>batch</p>' }); // the batch's part lands
		forced.resolve(); // (its ticket is older than the batch's part: not written)
		expect(await refresh).toBe('<p>batch</p>');
		expect(await joined).toBe('<p>batch</p>');
	});

	it('a forced fetch at a reserved address that fails fails the joiners it took on, and the batch end touches nothing', async () => {
		frames.reserve('a');
		const joined = frames.ensure('a', deferred().fetcher);
		const forced = deferred();
		const refresh = frames.ensure('a', forced.fetcher, { force: true });
		forced.reject(new Error('the refresh failed'));
		await expect(refresh).rejects.toThrow('the refresh failed');
		await expect(joined).rejects.toThrow('the refresh failed');
		frames.release('a'); // the batch ended without it
		const spy = vi.fn(deferred('OWN').fetcher);
		void frames.ensure('a', spy);
		expect(spy).toHaveBeenCalledTimes(1); // a binder now fetches on its own
	});

	it('a forced fetch that lands first settles the joiners of the reservation with its frame', async () => {
		frames.reserve('a');
		const joined = frames.ensure('a', deferred().fetcher);
		const forced = deferred('<p>refresh</p>');
		const refresh = frames.ensure('a', forced.fetcher, { force: true });
		forced.resolve();
		await refresh;
		const settled = await Promise.race([
			joined,
			new Promise((r) => setTimeout(() => r('still waiting'), 50))
		]);
		expect(settled).toBe('<p>refresh</p>');
	});

	it('release() is a no-op once the frame has landed', () => {
		frames.reserve('/r?sig=1');
		frames.write({ a: '/r?sig=1', v: 1, html: 'HAVE-IT' });
		frames.release('/r?sig=1'); // must not clobber delivered content
		expect(frames.peek('/r?sig=1')).toEqual({ v: 1, html: 'HAVE-IT' });
	});

	it('reserve() is a no-op when content or a fetch is already present', () => {
		frames.write({ a: '/have', v: 1, html: 'x' });
		frames.reserve('/have'); // has content — nothing to reserve
		const spy = vi.fn(deferred('Y').fetcher);
		void frames.ensure('/have', spy);
		expect(spy).not.toHaveBeenCalled(); // still served from content, not a stray reservation fetch
	});
});
