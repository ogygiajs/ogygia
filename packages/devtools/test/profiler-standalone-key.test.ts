// THE STANDALONE HTML EXPORT never hands the profiler's secret to an asset host. The export fetches
// the report page through the app (with the key, the page is behind the login), then every sheet
// and chunk the page names, at whatever URL it names: an app whose assets are on a CDN. Only the
// report page's own fetch may carry the key.
import { afterEach, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

const SECRET = 'a-profiler-secret-of-32-bytes-ok';
const CDN = 'https://cdn.example.com';

afterEach(() => {
	dev_switch.dev = true;
	vi.restoreAllMocks();
});

it('the standalone export sends the profiler key to no asset host', async () => {
	dev_switch.dev = false;
	const handle = profiler({ secret: SECRET });
	const asked: { url: string; key: string | null }[] = [];
	const answer = (input: RequestInfo | URL, init?: RequestInit): Response => {
		const url = String(input instanceof Request ? input.url : input);
		asked.push({ url, key: new Headers(init?.headers).get('x-profiler-key') });
		if (url.includes('/__profiler/report/'))
			return new Response(
				`<!doctype html><html><head><link rel="stylesheet" href="${CDN}/_app/a.css"><link rel="stylesheet" href="/_app/b.css"></head><body></body></html>`,
				{ headers: { 'content-type': 'text/html' } }
			);
		return new Response('a{}', { headers: { 'content-type': 'text/css' } });
	};
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (i, init) => answer(i, init));
	const dump = {
		kind: 'ogygia-profiler-dump',
		meta: { id: 'r1', path: '/x', runs: 1, at: 0 },
		analysis: {},
		extras: {}
	};
	const url = new URL('http://localhost/__profiler/report/r1.html');
	const event = {
		url,
		request: new Request(url, {
			method: 'POST',
			headers: { 'x-profiler-key': SECRET, 'content-type': 'application/json' },
			body: JSON.stringify(dump)
		}),
		route: { id: null },
		getClientAddress: () => '203.0.113.1',
		cookies: { get: () => undefined, set() {}, delete() {}, getAll: () => [], serialize: () => '' },
		fetch: async (i: RequestInfo | URL, init?: RequestInit) => answer(i, init)
	} as unknown as RequestEvent;
	const res = await handle({ event, resolve: async () => new Response('app') });
	expect(res.status).toBe(200);
	// the report page itself is fetched with the key; no sheet is, on the CDN or on the app
	expect(asked.filter((a) => a.url.includes('/__profiler/report/')).every((a) => a.key)).toBe(true);
	expect(asked.filter((a) => a.url.includes('/_app/'))).not.toEqual([]);
	expect(asked.filter((a) => !a.url.includes('/__profiler/report/') && a.key)).toEqual([]);
});
