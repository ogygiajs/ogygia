// Holes that start fetching in the same task go out as ONE batch POST (runtime/frame-nav.ts
// `join_batch`); a lone hole does not (one whose request the page's head started: early-holes.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join_batch } from '../../src/runtime/frame-nav.ts';
import { _reset, ensure, peek } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';
import { build_parcel, done_parcel } from '../../src/server/stream-regions.ts';

// (the address is the call — id + props — so each hole gets its own props)
const ep = (sig: string) => `/__ogygia__?id=aaaaaaaaaaaa&props=${sig}&exp=9999999999&sig=${sig}`;

function stub_batch(answer: (calls: string[]) => string) {
	const posts: string[][] = [];
	const spy = vi.spyOn(window, 'fetch').mockImplementation(async (_url, init) => {
		const calls = JSON.parse(String(init?.body)) as string[];
		posts.push(calls);
		await new Promise((r) => setTimeout(r, 20)); // (a network: the holes join before it answers)
		return new Response(answer(calls), { status: 200, headers: { 'content-type': 'text/html' } });
	});
	return { posts, spy };
}

afterEach(() => {
	vi.restoreAllMocks();
	_reset();
});

describe('join_batch', () => {
	it('two holes in one task: one POST, and each fetch joins it', async () => {
		const { posts } = stub_batch(
			(calls) =>
				calls
					.map((c) =>
						build_parcel(
							new URL(c, location.href).searchParams.get('sig')!,
							`<p>${c.slice(-1)}</p>`
						)
					)
					.join('') + done_parcel()
		);
		const own = vi.fn(async () => 'own');
		await Promise.all([join_batch(ep('s1')), join_batch(ep('s2'))]);
		const [a, b] = await Promise.all([
			ensure(frameAddress(ep('s1')), own),
			ensure(frameAddress(ep('s2')), own)
		]);
		expect(posts).toEqual([[ep('s1'), ep('s2')]]);
		expect(own).not.toHaveBeenCalled();
		expect([a, b]).toEqual(['<p>1</p>', '<p>2</p>']);
	});

	it('a lone hole goes on its own', async () => {
		const { posts } = stub_batch(() => done_parcel());
		await join_batch(ep('solo'));
		expect(posts).toEqual([]);
	});

	it('a frame the batch did not carry: the joined fetch rejects as a batch miss', async () => {
		stub_batch(() => done_parcel());
		await Promise.all([join_batch(ep('m1')), join_batch(ep('m2'))]);
		const err = await ensure(frameAddress(ep('m1')), async () => 'own').catch((e) => e);
		expect(err?.name).toBe('OgygiaBatchMiss');
		expect(peek(frameAddress(ep('m1')))).toBeNull();
	});
});
