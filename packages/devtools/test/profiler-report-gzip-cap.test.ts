// A report carried gzipped with the request is inflated under the same cap as an uploaded .ogp
// (#1106): past it the profiler stops inflating and answers 413 with the code's message, before the
// whole body is in memory.
import { expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';
import { OGP_MAX_UNPACKED } from '../src/profiler/crypto.ts';

vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => true }));

const KEY = { 'x-profiler-key': 'prof-key-of-16-bytes-or-more' };

it('a gzipped report that inflates past the cap is refused with 413, not inflated whole', async () => {
	// one gzip member of 1 MiB of zeros, repeated: a few hundred kB that inflate past the cap
	const member = gzipSync(new Uint8Array(1_048_576));
	const n = Math.ceil(OGP_MAX_UNPACKED / 1_048_576) + 8;
	const body = new Uint8Array(member.byteLength * n);
	for (let i = 0; i < n; i++) body.set(member, i * member.byteLength);
	const url = 'http://localhost/__profiler/report/r1.json';
	const handle = profiler({ secret: 'prof-key-of-16-bytes-or-more' });
	const res = await handle({
		event: {
			url: new URL(url),
			request: new Request(url, {
				method: 'POST',
				headers: { ...KEY, 'content-type': 'application/json', 'x-og-encoding': 'gzip' },
				body
			}),
			route: { id: null },
			cookies: {
				get: () => undefined,
				set() {},
				delete() {},
				getAll: () => [],
				serialize: () => ''
			},
			fetch: async () => new Response('ok')
		} as unknown as RequestEvent,
		resolve: async () => new Response('no')
	});
	expect(res.status).toBe(413);
	expect(await res.text()).toMatch(/more than 256 MB/);
}, 30_000);
