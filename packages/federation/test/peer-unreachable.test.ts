// A peer that gives no answer at all (down, unreachable, slower than its timeout) is a failed hop,
// said as `federation_peer_unreachable` (#933): a static widget shows its boundary card and the page
// renders, a page read is a 504, and a deferred region's hole is a 504 (the browser asks again).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { isHttpError } from '@ogygia/router';
import { PeerHandle } from '../src/peer.ts';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import { install_federation, serve_federation } from '../src/serve.ts';
import { fed_app } from '../src/app.ts';
import fed_server from '../src/server.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
// (core internals a test drives: the running code's request)
import { set_current_request } from '../../core/src/plugin/facts.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
});

/** The peer is down: every fetch fails with no answer. What the console was told. */
function down(): string[] {
	vi.stubGlobal('fetch', async () => {
		throw new TypeError('fetch failed');
	});
	const warned: string[] = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warned.push(a.join(' ')));
	return warned;
}

const said = (warned: string[]) => warned.some((w) => w.includes('federation_peer_unreachable'));

describe('a peer that gives no answer at all', () => {
	it('a static widget: the boundary card in its place, and the code said', async () => {
		const warned = down();
		const dash = new PeerHandle('dash', { origin: 'https://dash.example' }, 'shell');
		const region = (await dash.widget('kpis')) as { html: string };
		expect(region.html).toContain('data-og-fragment-failed');
		expect(said(warned)).toBe(true);
	});

	it('a page read: a 504, and the code said', async () => {
		const warned = down();
		const dash = new PeerHandle('dash', { origin: 'https://dash.example' }, 'shell');
		const e = await dash.doc('/p', '').catch((err: unknown) => err);
		expect(isHttpError(e) && e.status).toBe(504);
		expect(said(warned)).toBe(true);
	});

	it("a deferred widget's hole: a 504, and the code said", async () => {
		install_federation(fed_app()!);
		const request = new Request('http://shell/x');
		set_current_request(() => request);
		const { dash } = federate({ name: 'shell', peers: { dash: { origin: 'http://dash.test' } } });
		const hole = await dash.widget('kpis', {}, { render: 'deferred' });
		set_current_request(null);
		const u = new URL((hole as { url: string }).url, 'http://shell');
		const warned = down();
		const res = (await serve_federation({
			url: u,
			request: new Request(u),
			cookies: { get: () => undefined },
			locals: {}
		} as unknown as RequestEvent))!;
		expect(res.status).toBe(504);
		expect(said(warned)).toBe(true);
	});
});

describe('a hop the asking request ended itself', () => {
	it('a page read: the fetch ends unsaid, and no other origin is asked', async () => {
		const asked: string[] = [];
		vi.stubGlobal(
			'fetch',
			(url: URL, init?: RequestInit) =>
				new Promise((_resolve, reject) => {
					asked.push(url.origin);
					const signal = init?.signal;
					if (signal?.aborted) return reject(signal.reason);
					signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
				})
		);
		const warned: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation(
			(...a: unknown[]) => void warned.push(a.join(' '))
		);
		const dash = new PeerHandle(
			'dash',
			{ origin: ['https://a.example', 'https://b.example'] },
			'shell'
		);
		const visitor = new AbortController();
		const request = new Request('http://shell/x', { signal: visitor.signal });
		set_current_request(() => request);
		const read = dash.doc('/p', '').catch((e: unknown) => e);
		set_current_request(null);
		await new Promise((r) => setTimeout(r, 0));
		expect(asked).toEqual(['https://a.example']);
		visitor.abort();
		const e = await read;
		expect(isHttpError(e)).toBe(false);
		await new Promise((r) => setTimeout(r, 10));
		expect(asked).toEqual(['https://a.example']);
		expect(warned.filter((w) => w.includes('federation_peer'))).toEqual([]);
	});

	it('a mutation whose answer breaks off mid-body fails with that break, as it came', async () => {
		const cut = new Error('the answer broke off');
		vi.stubGlobal(
			'fetch',
			async () =>
				new Response(
					new ReadableStream({
						start(c) {
							c.error(cut);
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
		);
		const dash = new PeerHandle('dash', { origin: 'https://dash.example' }, 'shell');
		const e = await dash
			.postDoc('/p', '', new ArrayBuffer(0), 'text/plain')
			.catch((err: unknown) => err);
		expect(e).toBe(cut);
	});
});
