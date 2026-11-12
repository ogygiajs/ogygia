/**
 * What `server/render-cache.ts` states, against the source: a hole with `ttl <= 0` is never shared
 * or kept, so concurrent calls each render and report `none`.
 */
import { beforeEach, expect, it } from 'vitest';
import {
	cached_render,
	render_cache_clear,
	render_cache_get,
	render_cache_key
} from '../src/server/render-cache.ts';

beforeEach(() => render_cache_clear());

it('a ttl of 0 renders for every call, concurrent or not, keeps nothing and reports none', async () => {
	let renders = 0;
	const body = async () => {
		renders++;
		await new Promise((r) => setTimeout(r, 10));
		return `<p>${renders}</p>`;
	};
	const key = render_cache_key('zero', 'p', '');
	const seen: string[] = [];
	await Promise.all(
		Array.from({ length: 3 }, () =>
			cached_render(body, { key, ttl: 0 }, (outcome) => seen.push(outcome))
		)
	);
	expect(renders).toBe(3);
	expect(seen).toEqual(['none', 'none', 'none']);
	expect(render_cache_get(key)).toBeNull();
});

it('a cached hole whose render fails, as null or by throwing, reports none', async () => {
	const seen: string[] = [];
	const report = (outcome: string) => seen.push(outcome);
	const null_key = render_cache_key('null', 'p', '');
	expect(await cached_render(() => null, { key: null_key, ttl: 60 }, report)).toBeNull();
	const throw_key = render_cache_key('throw', 'p', '');
	await expect(
		cached_render(
			() => {
				throw new Error('render failed');
			},
			{ key: throw_key, ttl: 60 },
			report
		)
	).rejects.toThrow('render failed');
	expect(seen).toEqual(['none', 'none']);
});
