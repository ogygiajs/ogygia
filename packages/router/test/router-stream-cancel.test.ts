// A streamed page whose visitor leaves (#284): the response body is cancelled while late regions
// still stream. The page's generator must be ended (its `finally` runs: a database cursor closed,
// say), every source a merged stream holds must be ended too, and nothing more renders.
import { describe, expect, it, vi } from 'vitest';
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
		// (the steps already asked for land, as each merge asks its sources one ahead; then nothing)
		const made = page.seen.made + late.seen.made;
		expect(made).toBeLessThan(10);
		await sleep(60);
		expect(page.seen.made + late.seen.made).toBe(made);
	});
});

// A source whose own cleanup (its `finally`) throws as the visitor leaves: nobody waits on that
// ending, so the failure is said with a code, never dropped.
describe('a source whose cleanup fails as the visitor leaves', () => {
	async function* torn(): AsyncGenerator<LateChunk> {
		try {
			for (let i = 0; ; i++) {
				await sleep(10);
				yield { slot: `t${i}`, html: `<p>t${i}</p>` };
			}
		} finally {
			// eslint-disable-next-line no-unsafe-finally
			throw new Error('cursor close failed');
		}
	}

	async function warned_after_cancel(make: () => AsyncGenerator<LateChunk>) {
		const warns: unknown[][] = [];
		const spy = vi.spyOn(console, 'warn').mockImplementation((...a) => void warns.push(a));
		try {
			const reader = stream_document(DOC, new Response(''), make()).body!.getReader();
			await reader.read();
			await reader.read();
			await reader.cancel();
			await sleep(60);
		} finally {
			spy.mockRestore();
		}
		return warns;
	}

	it('a page generator: request_cleanup_failed, with the error', async () => {
		const warns = await warned_after_cancel(torn);
		const hit = warns.find((a) => String(a[0]).includes('request_cleanup_failed'));
		expect(hit).toBeDefined();
		expect((hit![1] as Error).message).toBe('cursor close failed');
	});

	it('a source a merged stream holds: request_cleanup_failed, with the error', async () => {
		const warns = await warned_after_cancel(() =>
			until_drained(merge_chunks(source('p', 50).gen, torn()), () => null)
		);
		expect(warns.some((a) => String(a[0]).includes('request_cleanup_failed'))).toBe(true);
	});
});
