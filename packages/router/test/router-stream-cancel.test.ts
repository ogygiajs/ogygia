// A streamed page whose visitor leaves (#284): the response body is cancelled while late regions
// still stream. The page's generator must be ended (its `finally` runs: a database cursor closed,
// say), every source a merged stream holds must be ended too, and nothing more renders.
import { describe, expect, it } from 'vitest';
import { merge_chunks, stream_document, until_drained, type LateChunk } from '../src/stream.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DOC = '<html><head></head><body><main></main></body></html>';

/** A source of `n` chunks, one every 10 ms, that notes how far it got and whether it was ended. */
function source(name: string, n: number) {
	const seen = { made: 0, ended: false };
	async function* gen(): AsyncGenerator<LateChunk> {
		try {
			for (let i = 0; i < n; i++) {
				await sleep(10);
				seen.made++;
				yield { slot: `${name}${i}`, html: `<p>${name}${i}</p>` };
			}
		} finally {
			seen.ended = true;
		}
	}
	return { gen: gen(), seen };
}

describe('a streamed page the visitor left (#284)', () => {
	it('cancelling the body ends the page generator and renders nothing more', async () => {
		const page = source('p', 50);
		const res = stream_document(DOC, new Response(''), page.gen);
		const reader = res.body!.getReader();
		await reader.read(); // the document's head
		await reader.read(); // the first late chunk
		await reader.cancel();
		await sleep(60);
		expect(page.seen.ended).toBe(true);
		expect(page.seen.made).toBeLessThanOrEqual(2);
	});

	it('cancelling a merged, drained stream ends every source it holds', async () => {
		const page = source('p', 50);
		const late = source('l', 50);
		const res = stream_document(
			DOC,
			new Response(''),
			until_drained(merge_chunks(page.gen, late.gen), () => null)
		);
		const reader = res.body!.getReader();
		await reader.read();
		await reader.read();
		await reader.cancel();
		await sleep(60);
		expect(page.seen.ended).toBe(true);
		expect(late.seen.ended).toBe(true);
		expect(page.seen.made + late.seen.made).toBeLessThanOrEqual(4);
	});
});
