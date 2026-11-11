// HOLE-TRUST's client check holds for the router's batch too (router-nav.ts `batch_regions` →
// frame-nav.ts `streamFrames`, which POSTs to the first endpoint's path): no capability goes to
// another origin, and an answer that was redirected away writes nothing into the frame store. The
// browser twin: test/browser/batch-same-origin.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { scope } from '@ogygia/machine';

const { streamFrames } = await import('../src/runtime/frame-nav.ts');

const posted: string[] = [];
afterEach(() => {
	posted.length = 0;
	vi.unstubAllGlobals();
});

describe('single-flight batch: the endpoint origin', () => {
	it('never POSTs the page’s capabilities to a foreign origin', async () => {
		vi.stubGlobal('location', new URL('https://app.test/page'));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				posted.push(String(url));
				return new Response('', { status: 500 });
			})
		);
		const legit = '/__ogygia__?id=abcdef012345&props=W3t9XQ&exp=9999999999&sig=' + 'a'.repeat(64);
		const foreign =
			'https://evil.example/collect?id=abcdef012345&props=W3t9XQ&exp=9999999999&sig=' +
			'b'.repeat(64);
		const visit = scope();
		await streamFrames([foreign, legit], 'nav', visit);
		visit.close();
		for (const url of posted)
			expect(new URL(url, 'https://app.test').origin).toBe('https://app.test');
	});

	it('a batch answer from a redirected response never lands in the frame store', async () => {
		vi.stubGlobal('location', new URL('https://app.test/page'));
		const sig = 'c'.repeat(64);
		const body = `<template data-ogygia-slot="${sig}"><img src=x onerror=alert(1)></template><template data-ogygia-slot="__ogygia_done__"></template>`;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				const res = new Response(body, { status: 200 });
				// what a fetch that followed a redirect off the endpoint reports (hole-fetch.ts refuses it)
				Object.defineProperty(res, 'redirected', { value: true });
				Object.defineProperty(res, 'url', { value: 'https://evil.example/landing' });
				return res;
			})
		);
		const { subscribe } = await import('../src/runtime/frame-store.ts');
		const { frameAddress } = await import('../src/frame.ts');
		const a = '/__ogygia__?id=0123456789ab&props=W3t9XQ&exp=9999999999&sig=' + sig;
		const b = '/__ogygia__?id=ba9876543210&props=W3t9XQ&exp=9999999999&sig=' + 'd'.repeat(64);
		const landed: string[] = [];
		const off = subscribe(frameAddress(a), (f) => landed.push(f.html));
		const visit = scope();
		await streamFrames([a, b], 'nav', visit);
		visit.close();
		off();
		expect(landed).toEqual([]);
	});
});
