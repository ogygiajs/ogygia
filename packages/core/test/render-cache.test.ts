/**
 * R6 server-side region render cache — TTL, LRU bound, per-session isolation, no-store default.
 * The clock is set (`vi.setSystemTime`) where the TTL matters, so it is deterministic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	render_cache_key,
	render_cache_get,
	render_cache_clear,
	cached_render,
	type RenderKey
} from '../src/server/render-cache.ts';
import { ConcurrencyGate } from '../src/runtime/concurrency.ts';

beforeEach(() => render_cache_clear());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

/** Renders `html` for `key` through the cache (kept for `ttl` seconds). */
const put = (key: RenderKey, html: string, ttl: number) => cached_render(() => html, { key, ttl });
/** The key of region `id` with props `p` and no session. */
const k = (id: string) => render_cache_key(id, 'p', '');
const at = (ms: number) => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(ms);
	// the TTL is a duration: it is read on the monotonic clock (machine `clock.mono`, #472)
	vi.spyOn(performance, 'now').mockReturnValue(ms);
};

describe('render_cache_key', () => {
	it('includes the session seal so users never cross; excludes exp/sig (not passed) and ttl', () => {
		const a = render_cache_key('id1', 'PROPS', 'sessionA');
		const b = render_cache_key('id1', 'PROPS', 'sessionB');
		expect(a).not.toEqual(b); // different user → different key (no leak)
		expect(render_cache_key('id1', 'PROPS', '')).toEqual(render_cache_key('id1', 'PROPS', '')); // stable
	});
});

describe('render cache: what it keeps', () => {
	it('stores and serves within the TTL window, misses after expiry', async () => {
		const k = render_cache_key('id', 'p', '');
		at(1000);
		await put(k, '<b>hi</b>', 10); // expires at 1000 + 10_000 = 11_000
		at(5000);
		expect(render_cache_get(k)).toBe('<b>hi</b>'); // within window
		at(11_000);
		expect(render_cache_get(k)).toBe(null); // at expiry → miss
	});

	it('NEVER caches a dynamic (ttl <= 0) hole', async () => {
		const k = render_cache_key('id', 'p', '');
		await put(k, 'x', 0);
		expect(render_cache_get(k)).toBe(null);
		await put(k, 'x', -5);
		expect(render_cache_get(k)).toBe(null);
	});

	it('two users with the same props get isolated entries (no cross-serve)', async () => {
		const ka = render_cache_key('id', 'p', 'A');
		const kb = render_cache_key('id', 'p', 'B');
		await put(ka, 'A-html', 60);
		expect(render_cache_get(kb)).toBe(null); // user B never sees A's render
		await put(kb, 'B-html', 60);
		expect(render_cache_get(ka)).toBe('A-html');
		expect(render_cache_get(kb)).toBe('B-html');
	});

	it('props and a session that spell one string another way are another entry', async () => {
		// a visitor whose props end in what another visitor's session is: never one entry
		const mine = render_cache_key('id', '{"q":"a"} B', 'A');
		const theirs = render_cache_key('id', '{"q":"a"}', 'B A');
		await put(mine, 'mine', 60);
		expect(render_cache_get(theirs)).toBe(null);
	});

	it('bounds memory — past 500 entries the oldest evict', async () => {
		for (let i = 0; i < 600; i++) await put(k('k' + i), 'v' + i, 60);
		expect(render_cache_get(k('k0'))).toBe(null); // oldest evicted
		expect(render_cache_get(k('k599'))).toBe('v599'); // newest kept
	});

	it('a hit is an LRU touch — a recently-served entry survives eviction pressure', async () => {
		await put(k('keep'), 'v', 60);
		for (let i = 0; i < 499; i++) await put(k('f' + i), 'x', 60); // fill to 500
		await put(k('keep'), 'other', 60); // a hit (served 'v') → most-recent
		for (let i = 0; i < 100; i++) await put(k('g' + i), 'x', 60); // pressure
		expect(render_cache_get(k('keep'))).toBe('v'); // survived because touched
	});

	it('holds many small renders, but 2 MB renders evict each other long before 500 entries', async () => {
		const big = 'x'.repeat(2_000_000);
		for (let i = 0; i < 40; i++) await put(k('big' + i), big, 60);
		const kept = Array.from({ length: 40 }, (_, i) => render_cache_get(k('big' + i))).filter(
			(v) => v !== null
		).length;
		expect(kept).toBeLessThan(40);
		expect(kept).toBeGreaterThan(20);
		expect(render_cache_get(k('big39'))).toBe(big); // the newest survive
		expect(render_cache_get(k('big0'))).toBeNull(); // the oldest went
	});
});

describe('cached_render — the shared seam (G2)', () => {
	it('renders once on cold, serves the memo on warm (within TTL)', async () => {
		let renders = 0;
		const body = () => {
			renders++;
			return '<p>' + renders + '</p>';
		};
		const cache = { key: render_cache_key('id', 'p', ''), ttl: 60 };
		at(1000);
		const a = await cached_render(body, cache);
		at(2000);
		const b = await cached_render(body, cache); // within TTL → memo, no re-render
		expect(a).toBe('<p>1</p>');
		expect(b).toBe('<p>1</p>');
		expect(renders).toBe(1); // rendered ONCE
	});

	it('re-renders after expiry, and NEVER caches a dynamic (no cache / ttl<=0) render', async () => {
		let renders = 0;
		const body = () => '<p>' + ++renders + '</p>';
		const cache = { key: render_cache_key('id2', 'p', ''), ttl: 10 };
		at(1000);
		await cached_render(body, cache); // render 1, expires 11_000
		at(11_000);
		await cached_render(body, cache); // expired → render 2
		expect(renders).toBe(2);
		// no cache object → always renders
		await cached_render(body, undefined);
		await cached_render(body, undefined);
		expect(renders).toBe(4);
	});

	it('a null render (failure) is never cached', async () => {
		let calls = 0;
		const body = () => {
			calls++;
			return null;
		};
		const cache = { key: render_cache_key('id3', 'p', ''), ttl: 60 };
		expect(await cached_render(body, cache)).toBe(null);
		expect(await cached_render(body, cache)).toBe(null);
		expect(calls).toBe(2); // both attempted — a failed render didn't poison the cache
	});
});

describe('cached_render — one render per key in flight (#244)', () => {
	/** A render that takes `ms` of real time (a real upstream wait), counting how many ran. */
	function slow(ms: number | ((n: number) => number), answer: (n: number) => string) {
		let renders = 0;
		const body = async () => {
			const n = ++renders;
			await new Promise((r) => setTimeout(r, typeof ms === 'number' ? ms : ms(n)));
			return answer(n);
		};
		return {
			body,
			get renders() {
				return renders;
			}
		};
	}

	it('20 concurrent calls for one cached hole render it once, and all get its answer', async () => {
		const r = slow(20, (n) => `<p>${n}</p>`);
		const cache = { key: render_cache_key('burst', 'p', ''), ttl: 60 };
		const reports: string[] = [];
		const out = await Promise.all(
			Array.from({ length: 20 }, () => cached_render(r.body, cache, (o) => reports.push(o)))
		);
		expect(r.renders).toBe(1);
		expect(new Set(out)).toEqual(new Set(['<p>1</p>']));
		// the one that rendered stored it; the others were served without rendering
		expect(reports.filter((o) => o === 'miss')).toHaveLength(1);
		expect(reports.filter((o) => o === 'hit')).toHaveLength(19);
		// and the next call is a plain hit
		expect(await cached_render(r.body, cache)).toBe('<p>1</p>');
		expect(r.renders).toBe(1);
	});

	it('a failed render is not cached: the calls that joined it get its failure, the next call renders', async () => {
		const r = slow(20, (n) => {
			if (n === 1) throw new Error('upstream down');
			return `<p>${n}</p>`;
		});
		const cache = { key: render_cache_key('fails', 'p', ''), ttl: 60 };
		const out = await Promise.allSettled(
			Array.from({ length: 5 }, () => cached_render(r.body, cache))
		);
		expect(r.renders).toBe(1); // the joiners did not each try again
		for (const o of out) {
			expect(o.status).toBe('rejected');
			expect((o as PromiseRejectedResult).reason.message).toBe('upstream down');
		}
		expect(await cached_render(r.body, cache)).toBe('<p>2</p>');
		expect(r.renders).toBe(2);
	});

	it('different keys never share a render', async () => {
		const r = slow(10, (n) => `<p>${n}</p>`);
		const a = { key: render_cache_key('a', 'p', 'A'), ttl: 60 };
		const b = { key: render_cache_key('a', 'p', 'B'), ttl: 60 };
		await Promise.all([cached_render(r.body, a), cached_render(r.body, b)]);
		expect(r.renders).toBe(2);
	});

	it('an uncached hole renders for every call, concurrent or not', async () => {
		const r = slow(10, (n) => `<p>${n}</p>`);
		await Promise.all(Array.from({ length: 3 }, () => cached_render(r.body, undefined)));
		expect(r.renders).toBe(3);
	});

	it('a flight from before a clear stores nothing: its caller renders again, joined by the next', async () => {
		// (the first render takes 20 ms, the second 60: the old flight ends while the new one runs)
		const r = slow(
			(n) => (n === 1 ? 20 : 60),
			(n) => `<p>${n}</p>`
		);
		const cache = { key: render_cache_key('cleared', 'p', ''), ttl: 60 };
		const old = cached_render(r.body, cache);
		render_cache_clear(); // (ops: drop everything, the flight in progress too)
		const fresh = cached_render(r.body, cache); // the new flight for the same key
		const joined = cached_render(r.body, cache);
		// what the old flight rendered may be what the clear was for: nobody is handed it
		expect(await Promise.all([old, fresh, joined])).toEqual(['<p>2</p>', '<p>2</p>', '<p>2</p>']);
		expect(r.renders).toBe(2);
		expect(render_cache_get(cache.key)).toBe('<p>2</p>');
	});

	it('a render whose own request left before it started is not a failure for the calls that joined it (#245)', async () => {
		// a full render gate: the owner's render waits for a slot, and its visitor leaves meanwhile
		const gate = new ConcurrencyGate(1);
		const busy = gate.run(() => new Promise((r) => setTimeout(r, 30)));
		let renders = 0;
		const body = (signal?: AbortSignal) =>
			gate.run(
				async () => {
					renders++;
					return `<p>${renders}</p>`;
				},
				{ signal }
			);
		const cache = { key: render_cache_key('left', 'p', ''), ttl: 60 };
		const leave = new AbortController();
		const owner = cached_render(body, cache, undefined, leave.signal);
		const owner_out = owner.catch((e: unknown) => e);
		const joiner = cached_render(body, cache); // another request, still there
		leave.abort();
		expect(await owner_out).toBe(leave.signal.reason);
		// the render goes on for the joiner, once, and is stored
		expect(await joiner).toBe('<p>1</p>');
		expect(renders).toBe(1);
		expect(render_cache_get(cache.key)).toBe('<p>1</p>');
		await busy;
	});

	it('a render whose opener leaves while it waits for a slot keeps its place in the queue for the calls still waiting on it', async () => {
		// one slot, held; the cached hole's render waits for it, and a render of another hole after it
		const gate = new ConcurrencyGate(1);
		const busy = gate.run(() => new Promise((r) => setTimeout(r, 30)));
		const order: string[] = [];
		const leave = new AbortController();
		const hole = (signal?: AbortSignal): Promise<string> =>
			gate.run(
				async () => {
					order.push('hole');
					return '<p>hole</p>';
				},
				{ signal }
			);
		const cache = { key: render_cache_key('queued', 'p', ''), ttl: 60 };
		const owner = cached_render(hole, cache, undefined, leave.signal);
		const owner_out = owner.catch((e: unknown) => e);
		const joiner = cached_render(hole, cache); // another request, still there
		const other = gate.run(async () => {
			order.push('other');
		});
		leave.abort(); // the opener's visitor leaves while its render waits
		expect(await owner_out).toBe(leave.signal.reason);
		expect(await joiner).toBe('<p>hole</p>');
		await other;
		expect(order, 'the hole went to the back of the queue').toEqual(['hole', 'other']);
		await busy;
	});

	it('a render every caller left is stopped: it never takes a slot', async () => {
		const gate = new ConcurrencyGate(1);
		const busy = gate.run(() => new Promise((r) => setTimeout(r, 30)));
		let renders = 0;
		const body = (signal?: AbortSignal) =>
			gate.run(
				async () => {
					renders++;
					return '<p>x</p>';
				},
				{ signal }
			);
		const cache = { key: render_cache_key('all-left', 'p', ''), ttl: 60 };
		const a = new AbortController();
		const b = new AbortController();
		const one = cached_render(body, cache, undefined, a.signal).catch((e: unknown) => e);
		const two = cached_render(body, cache, undefined, b.signal).catch((e: unknown) => e);
		a.abort();
		b.abort();
		expect(await one).toBe(a.signal.reason);
		expect(await two).toBe(b.signal.reason);
		await busy;
		await new Promise((r) => setTimeout(r, 10));
		expect(renders).toBe(0);
	});
});
