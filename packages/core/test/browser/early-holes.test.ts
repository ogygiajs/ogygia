// A HOLE THAT LOADS AT ONCE IS ASKED FOR ONCE (#404). The page's head starts each `load` hole's
// request during the parse (early-holes.ts: one data block, one constant script), and the runtime
// takes that request over as the address's one flight in the frame store: the hole's own wake joins
// it, a batch leaves it out, and one nobody joins goes with the page's visit.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scope } from '@ogygia/machine';
import { early_holes_head } from '../../src/early-holes-head.ts';
import { adopt_early_holes } from '../../src/runtime/early-holes.ts';
import { join_batch } from '../../src/runtime/frame-nav.ts';
import { _reset, ensure, peek } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';
import { done_parcel } from '../../src/server/stream-regions.ts';

const ep = (sig: string) => `./__ogygia__?id=bbbbbbbbbbbb&props=${sig}&exp=9999999999&sig=${sig}`;

/** What the head does during the parse: the tags the server writes, each run as the parser would
 *  (a script element inserted with its text runs it; one parsed from markup would not). */
function start_early(endpoints: string[]) {
	const parsed = new DOMParser().parseFromString(
		`<head>${early_holes_head(endpoints)}</head>`,
		'text/html'
	);
	const placed: HTMLScriptElement[] = [];
	for (const from of parsed.head.querySelectorAll('script')) {
		const s = document.createElement('script');
		for (const a of from.attributes) s.setAttribute(a.name, a.value);
		s.textContent = from.textContent;
		document.head.append(s);
		placed.push(s);
	}
	for (const s of placed) s.remove();
}

/** The network: each GET answers its own `sig`, a POST (a batch) answers nothing. */
function stub_network() {
	const asked: { url: string; method: string }[] = [];
	const cancelled: string[] = [];
	vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
		const url = String(input instanceof Request ? input.url : input);
		asked.push({ url, method: init?.method ?? 'GET' });
		const sig = new URL(url, location.href).searchParams.get('sig');
		// (a network that hears its request's signal, as the browser's does)
		await new Promise<void>((resolve, reject) => {
			const t = setTimeout(resolve, 20);
			init?.signal?.addEventListener('abort', () => {
				clearTimeout(t);
				cancelled.push(sig ?? '');
				reject(init.signal!.reason);
			});
		});
		if (init?.method === 'POST') return new Response(done_parcel(), { status: 200 });
		return new Response(`<p>${sig}</p>`, {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	});
	return { asked, cancelled };
}

afterEach(() => {
	vi.restoreAllMocks();
	_reset();
});

describe('a hole the page started early', () => {
	it('is the flight at its address: its wake joins it, nothing asks again', async () => {
		const { asked } = stub_network();
		start_early([ep('e1')]);
		const visit = scope();
		adopt_early_holes(visit);
		const own = vi.fn(async () => 'own');
		expect(await ensure(frameAddress(ep('e1')), own)).toBe('<p>e1</p>');
		expect(own).not.toHaveBeenCalled();
		expect(asked).toHaveLength(1);
		visit.close();
	});

	it('started under a relative endpoint, matches the hole whose endpoint is root-absolute', async () => {
		const { asked } = stub_network();
		start_early([ep('r1')]);
		const visit = scope();
		adopt_early_holes(visit);
		const pinned = new URL(ep('r1'), location.href);
		const own = vi.fn(async () => 'own');
		expect(await ensure(frameAddress(pinned.pathname + pinned.search), own)).toBe('<p>r1</p>');
		expect(own).not.toHaveBeenCalled();
		expect(asked).toHaveLength(1);
		visit.close();
	});

	it('is left out of a batch: the other hole goes alone, no POST', async () => {
		const { asked } = stub_network();
		start_early([ep('b1')]);
		const visit = scope();
		adopt_early_holes(visit);
		await Promise.all([join_batch(ep('b1')), join_batch(ep('b2'))]);
		expect(asked.filter((a) => a.method === 'POST')).toEqual([]);
		visit.close();
	});

	it('is taken over once: a second adoption finds nothing to take', async () => {
		const { asked } = stub_network();
		start_early([ep('o1')]);
		const first = scope();
		const second = scope();
		adopt_early_holes(first);
		adopt_early_holes(second);
		second.close();
		expect(await ensure(frameAddress(ep('o1')), async () => 'own')).toBe('<p>o1</p>');
		expect(asked).toHaveLength(1);
		first.close();
	});

	it('that nobody joins, left before its answer lands: cancelled in the network, nothing written, nothing unhandled', async () => {
		const { cancelled } = stub_network();
		const unhandled: unknown[] = [];
		const on_unhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
		window.addEventListener('unhandledrejection', on_unhandled);
		try {
			start_early([ep('d1')]);
			const visit = scope();
			adopt_early_holes(visit);
			visit.close();
			await expect.poll(() => cancelled).toEqual(['d1']);
			await new Promise((r) => setTimeout(r, 50));
			expect(peek(frameAddress(ep('d1')))).toBeNull();
			expect(unhandled).toEqual([]);
		} finally {
			window.removeEventListener('unhandledrejection', on_unhandled);
		}
	});

	it('whose request fails before the runtime takes it over (or with no runtime at all): nothing unhandled', async () => {
		// (a plain stand-in, not a spy: a spy follows each promise it returns, which handles it)
		const real_fetch = window.fetch;
		window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
		const unhandled: unknown[] = [];
		const on_unhandled = (e: PromiseRejectionEvent) => {
			unhandled.push(e.reason);
			e.preventDefault();
		};
		window.addEventListener('unhandledrejection', on_unhandled);
		try {
			start_early([ep('f1')]);
			await new Promise((r) => setTimeout(r, 50));
			expect(unhandled).toEqual([]);
		} finally {
			window.fetch = real_fetch;
			window.removeEventListener('unhandledrejection', on_unhandled);
		}
	});

	it('a refused answer stays at its address: the hole that wakes later is refused too, and asks nothing', async () => {
		vi.spyOn(window, 'fetch').mockImplementation(
			async () => new Response('<!doctype html><html><body>sign in</body></html>', { status: 200 })
		);
		start_early([ep('x1')]);
		const visit = scope();
		adopt_early_holes(visit);
		await new Promise((r) => setTimeout(r, 20));
		const own = vi.fn(async () => 'own');
		const err = await ensure(frameAddress(ep('x1')), own).catch((e: unknown) => e);
		expect((err as Error)?.name).toBe('RegionAnswerRefused');
		expect(own).not.toHaveBeenCalled();
		expect(window.fetch).toHaveBeenCalledTimes(1);
		visit.close();
	});

	it('a refused answer the hole joined while it was out is not handed to it again: its next ask goes to the network (#1752)', async () => {
		vi.spyOn(window, 'fetch').mockImplementation(async () => {
			await new Promise((r) => setTimeout(r, 20));
			return new Response('', { status: 403, headers: { 'x-ogygia-deny': 'sig' } });
		});
		start_early([ep('j1')]);
		const visit = scope();
		adopt_early_holes(visit);
		const address = frameAddress(ep('j1'));
		const own = vi.fn(async () => '<p>own</p>');
		const heard = await ensure(address, own).catch((e: unknown) => e);
		expect((heard as Error)?.name).toBe('RegionAnswerRefused');
		expect(own).not.toHaveBeenCalled();
		expect(await ensure(address, own)).toBe('<p>own</p>');
		expect(own).toHaveBeenCalledTimes(1);
		expect(window.fetch).toHaveBeenCalledTimes(1);
		visit.close();
	});
});
