// Every body the profiler takes is read up to a cap that fits its route, and a body past it is a
// 413 before the rest is read (#1150): the login (open before sign-in), the beacon, an uploaded
// .ogp and a posted report. A body that never ends must not fill the server's memory.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { profiler } from '../src/profiler/index.ts';

const dev_switch = vi.hoisted(() => ({ dev: true }));
vi.mock('../src/profiler/env.ts', () => ({ detect_dev: () => dev_switch.dev }));

const SECRET = 'a-profiler-secret-of-32-bytes-ok';
const CHUNK = 64 * 1024;
const CHUNKS = 2048; // 128 MiB, past every cap

/** A body of `CHUNKS` chunks with no content-length, and how many bytes the server pulled. */
function endless(): { body: ReadableStream<Uint8Array>; pulled: () => number } {
	let n = 0;
	const chunk = new Uint8Array(CHUNK).fill(0x61);
	return {
		body: new ReadableStream({
			pull(c) {
				if (n === CHUNKS) return c.close();
				n++;
				c.enqueue(chunk);
			}
		}),
		pulled: () => n * CHUNK
	};
}

/** A body that sends one chunk and then fails, as a client that aborts mid-upload does. */
function breaks(): ReadableStream<Uint8Array> {
	let sent = false;
	return new ReadableStream({
		pull(c) {
			if (sent) return c.error(new Error('connection reset'));
			sent = true;
			c.enqueue(new Uint8Array(16).fill(0x61));
		}
	});
}

function post(path: string, body: ReadableStream<Uint8Array>, headers: Record<string, string>) {
	const url = new URL(`http://localhost${path}`);
	return {
		url,
		request: new Request(url, { method: 'POST', body, headers, duplex: 'half' } as RequestInit),
		route: { id: null },
		getClientAddress: () => '203.0.113.1',
		cookies: { get: () => undefined, set() {}, delete() {}, getAll: () => [], serialize: () => '' },
		fetch: async () => new Response('ok')
	} as unknown as RequestEvent;
}

afterEach(() => {
	dev_switch.dev = true;
	vi.restoreAllMocks();
});

const KEY = { 'x-profiler-key': SECRET };
const routes: [string, string, Record<string, string>][] = [
	['the login, open before sign-in', '/__profiler/login', { 'content-type': 'application/json' }],
	['the beacon', '/__profiler/beacon', { ...KEY, 'content-type': 'text/plain' }],
	['an uploaded .ogp', '/__profiler/view', { ...KEY, 'content-type': 'application/octet-stream' }],
	[
		'a posted report',
		'/__profiler/report/abc.json',
		{ ...KEY, 'content-type': 'application/octet-stream' }
	]
];

describe('profiler request bodies are capped (#1150)', () => {
	for (const [what, path, headers] of routes) {
		it(`${what}: a body past its cap is 413, and the rest is never read`, async () => {
			dev_switch.dev = false;
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			const handle = profiler({ secret: SECRET });
			const { body, pulled } = endless();
			const res = await handle({
				event: post(path, body, headers),
				resolve: async () => new Response('app')
			});
			expect(res.status).toBe(413);
			expect(pulled()).toBeLessThan(CHUNKS * CHUNK);
		});

		it(`${what}: a body that breaks off mid-upload is a 400, not a thrown error (#1427)`, async () => {
			dev_switch.dev = false;
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			const handle = profiler({ secret: SECRET });
			const res = await handle({
				event: post(path, breaks(), headers),
				resolve: async () => new Response('app')
			});
			expect(res.status).toBe(400);
		});
	}
});
