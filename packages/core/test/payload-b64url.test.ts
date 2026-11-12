// The hole props payload's URL-safe base64 (src/server/payload.ts): Node's Buffer path and the
// portable path (an edge runtime with no Buffer) give the same unpadded text, and read each other's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { B64Url as NodeB64 } from '../src/server/payload.ts';

async function portable(): Promise<typeof NodeB64> {
	vi.stubGlobal('Buffer', undefined);
	vi.resetModules();
	return (await import('../src/server/payload.ts')).B64Url;
}

const SAMPLES = ['', 'a', 'ab', 'abc', 'abcd', '{"n":1}', 'é ü ✓ 🏝', '>>>???', '\u0000ÿ'];

describe('B64Url', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('both paths give the same unpadded, URL-safe text', async () => {
		const Edge = await portable();
		for (const s of SAMPLES) {
			const a = NodeB64.encode(s);
			expect(Edge.encode(s), s).toBe(a);
			expect(a).toMatch(/^[A-Za-z0-9_-]*$/);
		}
	});

	it('each path reads what the other wrote', async () => {
		const Edge = await portable();
		for (const s of SAMPLES) {
			expect(Edge.decode(NodeB64.encode(s)), s).toBe(s);
			expect(NodeB64.decode(Edge.encode(s)), s).toBe(s);
		}
	});
});
