/**
 * R6 server-side region render cache — TTL, LRU bound, per-session isolation, no-store default.
 * `now` is injected so TTL is deterministic (no wall-clock in tests).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	render_cache_key,
	render_cache_get,
	render_cache_set,
	render_cache_clear,
	cached_render
} from '../src/server/render-cache.ts';
import { ConcurrencyGate } from '../src/runtime/concurrency.ts';

beforeEach(() => render_cache_clear());

describe('render_cache_key', () => {
	it('includes the session seal so users never cross; excludes exp/sig (not passed) and ttl', () => {
		const a = render_cache_key('id1', 'PROPS', 'sessionA');
		const b = render_cache_key('id1', 'PROPS', 'sessionB');
		expect(a).not.toBe(b); // different user → different key (no leak)
		expect(render_cache_key('id1', 'PROPS', '')).toBe(render_cache_key('id1', 'PROPS', '')); // stable
	});
});

describe('render_cache get/set', () => {
	it('stores and serves within the TTL window, misses after expiry', () => {
		const k = render_cache_key('id', 'p', '');
		render_cache_set(k, '<b>hi</b>', 10, 1000); // expires at 1000 + 10_000 = 11_000
		expect(render_cache_get(k, 5000)).toBe('<b>hi</b>'); // within window
		expect(render_cache_get(k, 11_000)).toBe(null); // at expiry → miss + evict
		expect(render_cache_get(k, 5000)).toBe(null); // evicted, gone
	});

	it('NEVER caches a dynamic (ttl <= 0) hole', () => {
		const k = render_cache_key('id', 'p', '');
		render_cache_set(k, 'x', 0, 1000);
		expect(render_cache_get(k, 1001)).toBe(null);
		render_cache_set(k, 'x', -5, 1000);
		expect(render_cache_get(k, 1001)).toBe(null);
	});

	it('two users with the same props get isolated entries (no cross-serve)', () => {
		const ka = render_cache_key('id', 'p', 'A');
		const kb = render_cache_key('id', 'p', 'B');
		render_cache_set(ka, 'A-html', 60, 0);
		expect(render_cache_get(kb, 1)).toBe(null); // user B never sees A's render
		render_cache_set(kb, 'B-html', 60, 0);
		expect(render_cache_get(ka, 1)).toBe('A-html');
		expect(render_cache_get(kb, 1)).toBe('B-html');
	});

	it('bounds memory — past 500 entries the oldest evict', () => {
		for (let i = 0; i < 600; i++) render_cache_set('k' + i, 'v' + i, 60, 0);
		expect(render_cache_get('k0', 1)).toBe(null); // oldest evicted
		expect(render_cache_get('k599', 1)).toBe('v599'); // newest kept
	});

	it('a read is an LRU touch — a recently-read entry survives eviction pressure', () => {
		render_cache_set('keep', 'v', 60, 0);
		for (let i = 0; i < 499; i++) render_cache_set('f' + i, 'x', 60, 0); // fill to 500
		render_cache_get('keep', 1); // touch → most-recent
		for (let i = 0; i < 100; i++) render_cache_set('g' + i, 'x', 60, 0); // pressure
		expect(render_cache_get('keep', 1)).toBe('v'); // survived because touched
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
		const a = await cached_render(body, cache, 1000);
		const b = await cached_render(body, cache, 2000); // within TTL → memo, no re-render
		expect(a).toBe('<p>1</p>');
		expect(b).toBe('<p>1</p>');
		expect(renders).toBe(1); // rendered ONCE
	});

	it('re-renders after expiry, and NEVER caches a dynamic (no cache / ttl<=0) render', async () => {
		let renders = 0;
		const body = () => '<p>' + ++renders + '</p>';
		const cache = { key: render_cache_key('id2', 'p', ''), ttl: 10 };
		await cached_render(body, cache, 1000); // render 1, expires 11_000
		await cached_render(body, cache, 11_000); // expired → render 2
		expect(renders).toBe(2);
		// no cache object → always renders
		await cached_render(body, undefined, 1);
		await cached_render(body, undefined, 2);
		expect(renders).toBe(4);
	});

	it('a null render (failure) is never cached', async () => {
		let calls = 0;
		const body = () => {
			calls++;
			return null;
		};
		const cache = { key: render_cache_key('id3', 'p', ''), ttl: 60 };
		expect(await cached_render(body, cache, 1)).toBe(null);
		expect(await cached_render(body, cache, 2)).toBe(null);
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
			Array.from({ length: 20 }, () =>
				cached_render(r.body, cache, Date.now(), (o) => reports.push(o))
			)
		);
		expect(r.renders).toBe(1);
		expect(new Set(out)).toEqual(new Set(['<p>1</p>']));
		// the one that rendered stored it; the others were served without rendering
		expect(reports.filter((o) => o === 'miss')).toHaveLength(1);
		expect(reports.filter((o) => o === 'hit')).toHaveLength(19);
		// and the next call is a plain hit
		expect(await cached_render(r.body, cache, Date.now())).toBe('<p>1</p>');
		expect(r.renders).toBe(1);
	});

	it('a failed render is not cached: the calls that joined it get its failure, the next call renders', async () => {
		const r = slow(20, (n) => {
			if (n === 1) throw new Error('upstream down');
			return `<p>${n}</p>`;
		});
		const cache = { key: render_cache_key('fails', 'p', ''), ttl: 60 };
		const out = await Promise.allSettled(
			Array.from({ length: 5 }, () => cached_render(r.body, cache, Date.now()))
		);
		expect(r.renders).toBe(1); // the joiners did not each try again
		for (const o of out) {
			expect(o.status).toBe('rejected');
			expect((o as PromiseRejectedResult).reason.message).toBe('upstream down');
		}
		expect(await cached_render(r.body, cache, Date.now())).toBe('<p>2</p>');
		expect(r.renders).toBe(2);
	});

	it('different keys never share a render', async () => {
		const r = slow(10, (n) => `<p>${n}</p>`);
		const a = { key: render_cache_key('a', 'p', 'A'), ttl: 60 };
		const b = { key: render_cache_key('a', 'p', 'B'), ttl: 60 };
		await Promise.all([cached_render(r.body, a, Date.now()), cached_render(r.body, b, Date.now())]);
		expect(r.renders).toBe(2);
	});

	it('an uncached hole renders for every call, concurrent or not', async () => {
		const r = slow(10, (n) => `<p>${n}</p>`);
		await Promise.all(
			Array.from({ length: 3 }, () => cached_render(r.body, undefined, Date.now()))
		);
		expect(r.renders).toBe(3);
	});

	it('a flight from before a clear stores nothing and never removes the flight after it', async () => {
		// (the first render takes 20 ms, the second 60: the old flight ends while the new one runs)
		const r = slow(
			(n) => (n === 1 ? 20 : 60),
			(n) => `<p>${n}</p>`
		);
		const cache = { key: render_cache_key('cleared', 'p', ''), ttl: 60 };
		const old = cached_render(r.body, cache, Date.now());
		render_cache_clear(); // (ops: drop everything, the flight in progress too)
		const fresh = cached_render(r.body, cache, Date.now()); // a new flight for the same key
		expect(await old).toBe('<p>1</p>'); // its own caller still gets its answer …
		// … but it is not stored, and the fresh flight is still the one a new call joins
		const joined = cached_render(r.body, cache, Date.now());
		expect(await Promise.all([fresh, joined])).toEqual(['<p>2</p>', '<p>2</p>']);
		expect(r.renders).toBe(2);
	});

	it('a render whose own request left before it started is not a failure for the calls that joined it (#245)', async () => {
		// a full render gate: the owner's render waits for a slot, and its visitor leaves meanwhile
		const gate = new ConcurrencyGate(1);
		const busy = gate.run(() => new Promise((r) => setTimeout(r, 30)));
		let renders = 0;
		const body = (signal?: AbortSignal) => () =>
			gate.run(
				async () => {
					renders++;
					return `<p>${renders}</p>`;
				},
				{ signal }
			);
		const cache = { key: render_cache_key('left', 'p', ''), ttl: 60 };
		const leave = new AbortController();
		const owner = cached_render(body(leave.signal), cache, Date.now(), undefined, leave.signal);
		const owner_out = owner.catch((e: unknown) => e);
		const joiner = cached_render(body(), cache, Date.now()); // another request, still there
		leave.abort();
		expect(await owner_out).toBe(leave.signal.reason);
		// the joiner renders it itself, once, and stores it
		expect(await joiner).toBe('<p>1</p>');
		expect(renders).toBe(1);
		expect(render_cache_get(cache.key, Date.now())).toBe('<p>1</p>');
		await busy;
	});
});
