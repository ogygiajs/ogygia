/**
 * The `.ogp` layout, the sink buffer's drop order, the saving arithmetic standing alone, and the
 * session found among many cookies.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ogp_decode, ogp_encode } from '../src/profiler/crypto.ts';
import { SinkBuffer, parse_sink, type SinkRow } from '../src/profiler/sink.ts';
import { session_cookie_values } from '../src/profiler/session-cookie.ts';

describe('the .ogp layout', () => {
	it("is 'OGP1', a 16-byte salt, a 12-byte iv, the ciphertext and a 16-byte tag", async () => {
		const bytes = await ogp_encode({ a: 1 }, 's');
		expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('OGP1');
		// a flipped bit anywhere in salt, iv, ciphertext or tag fails the decode
		for (const at of [4, 19, 20, 31, 32, bytes.length - 17, bytes.length - 16, bytes.length - 1]) {
			const bad = new Uint8Array(bytes);
			bad[at] ^= 1;
			await expect(ogp_decode(bad, 's'), `byte ${at}`).rejects.toThrow();
		}
		expect(await ogp_decode(bytes, 's')).toEqual({ a: 1 });
	});
});

describe('the sink buffer', () => {
	const req = (t: number): SinkRow => ({
		k: 'req',
		t,
		path: '/a',
		route: '/a',
		ms: 1,
		cpu: 1,
		wait: 0,
		status: 200
	});

	it('when full, drops the oldest request rows, never a window or a catch', () => {
		const b = new SinkBuffer(500);
		b.push({ k: 'win', t0: 0, t1: 1, fns: [] });
		b.push({ k: 'trap', t: 0, path: '/a', ms: 1, id: 'x' });
		for (let i = 0; i < 30; i++) b.push(req(i));
		const rows = parse_sink(b.drain());
		expect(rows[0].k).toBe('win');
		expect(rows[1].k).toBe('trap');
		const ts = rows.slice(2).map((r) => (r as { t: number }).t);
		expect(ts.length).toBeLessThan(30);
		expect(ts.at(-1)).toBe(29);
		expect(ts).toEqual([...ts].sort((a, b) => a - b));
	});
});

describe('the saving arithmetic', () => {
	it('imports nothing, so the report page runs the same code in the browser', () => {
		const src = readFileSync(new URL('../src/profiler/saving.ts', import.meta.url), 'utf8');
		expect(src).not.toMatch(/^\s*import\s/m);
	});
});

describe('the profiler session among many cookies', () => {
	const event = (cookie: string, parsed?: string) =>
		({
			cookies: { get: () => parsed },
			request: new Request('https://example.com/', { headers: { cookie } })
		}) as never;

	it("tries Kit's parsed value first, then every raw pair once", () => {
		expect(session_cookie_values(event('og_profiler=a; x=1; og_profiler=b', 'b'))).toEqual([
			'b',
			'a'
		]);
	});

	it("finds a session Kit's parser missed", () => {
		expect(session_cookie_values(event('bad=%E0%A4%A; og_profiler=s'))).toEqual(['s']);
	});
});
