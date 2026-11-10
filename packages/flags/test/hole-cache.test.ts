/**
 * A cached hole and a flag (#434): the hole render cache keeps a render for its `maxAge`, keyed by
 * the hole's call and the visitor's session. A render that read a flag is one visitor's: it is never
 * served to a visitor in another bucket.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { inRequest, startPlugin } from '@ogygia/core/plugin/testing';
import {
	cached_render,
	render_cache_clear,
	render_cache_key
} from '@ogygia/core/internal/server';
import server from '../src/server.ts';
import { flag } from '../src/index.ts';

startPlugin(server, { name: '@ogygia/flags' });

const hero = flag('hole-cache-hero', { a: 1, b: 1 });

/** A visitor whose bucket for `hero` is `variant`. */
function visitor_in(variant: string): string {
	for (let i = 0; i < 1000; i++) {
		const sub = `v-${i}`;
		const request = new Request('http://x/');
		if (hero({ request, url: new URL(request.url), visitor: { sub } }) === variant) return sub;
	}
	throw new Error(`no visitor lands in ${variant}`);
}

/** One anonymous visitor's request for the cached hole: its render reads the flag. */
function ask_hole(sub: string): Promise<string | null> {
	const request = new Request('http://x/_ogygia/region?id=h');
	const url = new URL(request.url);
	return inRequest({ request, url }, () =>
		cached_render(() => `<p>${hero({ request, url, visitor: { sub } })}</p>`, {
			// no session cookie: the visitors are anonymous, the session part of the key is empty
			key: render_cache_key('h', '{}', ''),
			ttl: 60
		})
	);
}

afterEach(() => render_cache_clear());

describe('a cached hole that reads a flag', () => {
	it('answers two visitors in two buckets with their own variants', async () => {
		const in_a = visitor_in('a');
		const in_b = visitor_in('b');
		expect(await ask_hole(in_b)).toBe('<p>b</p>');
		expect(await ask_hole(in_a)).toBe('<p>a</p>');
	});

	it('answers a visitor who joins another bucket render in flight with their own variant', async () => {
		const in_a = visitor_in('a');
		const in_b = visitor_in('b');
		const [first, second] = await Promise.all([ask_hole(in_b), ask_hole(in_a)]);
		expect(first).toBe('<p>b</p>');
		expect(second).toBe('<p>a</p>');
	});
});
