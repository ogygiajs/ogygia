import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	decode_permalink,
	encode_permalink,
	is_webkit_capped
} from '../src/profiler/ui/permalink.ts';

// made by encode_permalink({ route: '/a', runs: [1, 2] }, 'pw') when this test was written
const EARLIER =
	'T0dMMUSbvGvjuG8OMaY3XwUh22nAy_XysGQPCtTZ5r6ZGwzi59ssl6ypMWZFIaClMYW7rnTJ2iSQLSR-xPmLVND1P2fGsFaF--Zd5KVU-l67UhxtJQ_dXFZAfpveBjU';

describe('permalink', () => {
	it('a share link made earlier still opens', async () => {
		expect(await decode_permalink(EARLIER, 'pw')).toEqual({ route: '/a', runs: [1, 2] });
	});

	it('a share link opens only with its password', async () => {
		await expect(decode_permalink(EARLIER, 'not-pw')).rejects.toThrow();
	});

	it('a blob that is not an ogygia share link is refused by name', async () => {
		await expect(decode_permalink('aGVsbG8gd29ybGQ', 'pw')).rejects.toThrow(
			'not an ogygia share link'
		);
	});

	it('a share link is fragment-safe text (no +, / or =) and opens again', async () => {
		for (const size of [0, 1, 2, 40, 41, 42, 500]) {
			const report = { pad: 'x'.repeat(size), bytes: Array.from({ length: size }, (_, i) => i) };
			const link = await encode_permalink(report, 'pw');
			expect(link).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(await decode_permalink(link, 'pw')).toEqual(report);
		}
	});
});

describe('is_webkit_capped', () => {
	afterEach(() => vi.unstubAllGlobals());
	const capped = (userAgent: string) => {
		vi.stubGlobal('navigator', { userAgent });
		return is_webkit_capped();
	};

	it('every iOS browser and desktop Safari are capped; Chromium and Firefox are not', () => {
		expect(
			capped(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
			)
		).toBe(true);
		expect(
			capped(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1'
			)
		).toBe(true);
		expect(
			capped(
				'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15'
			)
		).toBe(true);
		expect(
			capped(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
			)
		).toBe(false);
		expect(
			capped(
				'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36'
			)
		).toBe(false);
		expect(
			capped('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0')
		).toBe(false);
	});
});
