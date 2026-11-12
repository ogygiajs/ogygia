/**
 * The `.ogp` codec's slow steps (the key derivation and Brotli) never run on the event loop: the
 * synchronous forms throw here, so a codec that called them fails.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (original) => ({
	...(await original<typeof import('node:crypto')>()),
	scryptSync: () => {
		throw new Error('scryptSync blocks the event loop');
	}
}));
vi.mock('node:zlib', async (original) => ({
	...(await original<typeof import('node:zlib')>()),
	brotliCompressSync: () => {
		throw new Error('brotliCompressSync blocks the event loop');
	},
	brotliDecompressSync: () => {
		throw new Error('brotliDecompressSync blocks the event loop');
	}
}));

describe('the .ogp codec', () => {
	it('derives the key and compresses off the event loop', async () => {
		const { ogp_decode, ogp_encode } = await import('../src/profiler/crypto.ts');
		const bytes = await ogp_encode({ a: 1 }, 's');
		expect(await ogp_decode(bytes, 's')).toEqual({ a: 1 });
	});
});
