import { describe, expect, it } from 'vitest';
import { scope } from '@ogygia/machine';
import { bake_yield, stream_document, type LateChunk } from '../src/stream.ts';

const DOC = '<html><head></head><body><main></main></body></html>';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function* chunks(...list: LateChunk[]): AsyncGenerator<LateChunk> {
	yield* list;
}

describe('a streamed response', () => {
	it('drops a content-length the page response carried, so the stream is not cut short', () => {
		const res = stream_document(
			DOC,
			new Response('', { headers: { 'content-length': '12' } }),
			chunks()
		);
		expect(res.headers.get('content-length')).toBeNull();
	});

	it('sets cache-control: no-transform when the page set no cache-control', () => {
		const res = stream_document(DOC, new Response(''), chunks());
		expect(res.headers.get('cache-control')).toBe('no-transform');
	});

	it('adds no-transform to a cache-control the page set, keeping what it said', () => {
		const res = stream_document(
			DOC,
			new Response('', { headers: { 'cache-control': 'private, max-age=0' } }),
			chunks()
		);
		expect(res.headers.get('cache-control')).toBe('private, max-age=0, no-transform');
	});

	it('leaves a cache-control that already says no-transform as it is', () => {
		const res = stream_document(
			DOC,
			new Response('', { headers: { 'cache-control': 'No-Transform, public' } }),
			chunks()
		);
		expect(res.headers.get('cache-control')).toBe('No-Transform, public');
	});

	it('puts the error card of a throwing chunk source in the slot it was given', async () => {
		async function* broken(): AsyncGenerator<LateChunk> {
			yield* chunks();
			throw new Error('db down');
		}
		const html = await stream_document(DOC, new Response(''), broken(), 'slot-7').text();
		expect(html).toMatch(/<template[^>]*slot-7[^>]*>[^]*data-og-late-error[^]*db down/);
	});

	it('ends the page generator when the request it belongs to ends', async () => {
		const seen = { ended: false };
		async function* slow(): AsyncGenerator<LateChunk> {
			try {
				for (let i = 0; ; i++) {
					await sleep(10);
					yield { slot: 'pg', html: `<p>${i}</p>` };
				}
			} finally {
				seen.ended = true;
			}
		}
		const request = scope();
		const reader = stream_document(
			DOC,
			new Response(''),
			slow(),
			undefined,
			request
		).body!.getReader();
		await reader.read();
		await reader.read();
		request.close();
		await sleep(30);
		expect(seen.ended).toBe(true);
	});
});

describe('bake_yield', () => {
	it('bakes a region still waiting on its promise (a sync generator yields it unresolved)', async () => {
		expect(await bake_yield(Promise.resolve({ kind: 'inline', html: '<p>late</p>' }))).toBe(
			'<p>late</p>'
		);
	});
});
