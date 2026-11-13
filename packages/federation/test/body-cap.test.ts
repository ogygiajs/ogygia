// A federation route's body cap holds whatever the headers say (#1091): a body sent without a
// content-length (chunked) is refused once it passes the cap, before the signature is checked and
// without being read to its end.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { read_capped_body } from '../src/wire.ts';

const SEED = 314;

/** `sizes` pieces as a body without a content-length, counting the pieces pulled. */
function streamed(sizes: number[]) {
	const seen = { pulls: 0 };
	let n = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(c) {
			seen.pulls++;
			if (n === sizes.length) return c.close();
			const piece = new Uint8Array(sizes[n]);
			piece.fill(n++ % 251);
			c.enqueue(piece);
		}
	});
	const request = new Request('http://peer.test/og/thaw', {
		method: 'POST',
		body,
		duplex: 'half'
	} as RequestInit);
	return { request, seen };
}

describe('read_capped_body', () => {
	it('a chunked body past the cap is refused, read no further than one piece past it', async () => {
		const { request, seen } = streamed(Array.from({ length: 200 }, () => 64 * 1024));
		expect(await read_capped_body(request, 1024 * 1024)).toBe('too large');
		// 16 pieces fill the cap; the 17th passes it
		expect(seen.pulls).toBeLessThanOrEqual(17);
	});

	it('any chunking: the bytes as sent when within the cap, else too large; never a piece past the cap', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.nat({ max: 300 }), { maxLength: 40 }),
				fc.nat({ max: 4000 }),
				async (sizes, max) => {
					const total = sizes.reduce((a, b) => a + b, 0);
					const { request, seen } = streamed(sizes);
					const got = await read_capped_body(request, max);
					if (total > max) {
						expect(got).toBe('too large');
						// the pieces up to the one that passed the cap, and no further
						let sum = 0;
						let need = 0;
						while (sum <= max) sum += sizes[need++];
						expect(seen.pulls).toBeLessThanOrEqual(need + 1);
					} else {
						expect(got).toBeInstanceOf(Uint8Array);
						const bytes = new Uint8Array(got as Uint8Array);
						expect(bytes.byteLength).toBe(total);
						let at = 0;
						sizes.forEach((s, i) => {
							for (let j = 0; j < s; j++) expect(bytes[at++]).toBe(i % 251);
						});
					}
				}
			),
			{ seed: SEED, numRuns: 300 }
		);
	});

	it('a GET or HEAD has no body to read', async () => {
		expect(await read_capped_body(new Request('http://peer.test/x'), 10)).toBeUndefined();
		expect(
			await read_capped_body(new Request('http://peer.test/x', { method: 'HEAD' }), 10)
		).toBeUndefined();
	});
});
