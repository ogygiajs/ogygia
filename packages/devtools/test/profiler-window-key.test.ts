// A WINDOW ID IS SIGNED WITH THE PROFILER'S SECRET. A request that carries one (`x-og-window`) is
// written to the shared store as part of that window. A production profiler with no secret has no
// key to check one with: it takes none (the fixed dev key is for dev only).
import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';
import { MemoryStore } from '../src/profiler/storage/index.ts';

vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => false }));

function event(path: string, headers: Record<string, string>): RequestEvent {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, { headers }),
		route: { id: null },
		cookies: { get: () => undefined, set() {}, delete() {}, getAll: () => [], serialize: () => '' },
		fetch: async () => new Response('ok')
	} as unknown as RequestEvent;
}

it('a production profiler with no secret writes no request under a window id', async () => {
	const store = new MemoryStore();
	const put = vi.spyOn(store, 'putVisit');
	const handle = profiler({ store });
	const nonce = 'n0nce';
	const sig = createHmac('sha256', 'ogygia-dev-window')
		.update(`window:${nonce}`)
		.digest('hex')
		.slice(0, 20);
	await handle({
		event: event('/page', { 'x-og-window': `${nonce}.${sig}` }),
		resolve: async () => new Response('page')
	});
	await new Promise((r) => setTimeout(r, 20));
	expect(put).not.toHaveBeenCalled();
});

it('a window id signed the old way (a bare HMAC of the nonce, no lifetime) is not taken', async () => {
	const secret = 'a-profiler-secret-of-32-bytes-ok';
	const store = new MemoryStore();
	const put = vi.spyOn(store, 'putVisit');
	const handle = profiler({ store, secret });
	const nonce = 'n0nce';
	const sig = createHmac('sha256', secret).update(`window:${nonce}`).digest('hex').slice(0, 20);
	await handle({
		event: event('/page', { 'x-og-window': `${nonce}.${sig}` }),
		resolve: async () => new Response('page')
	});
	await new Promise((r) => setTimeout(r, 20));
	expect(put).not.toHaveBeenCalled();
});
