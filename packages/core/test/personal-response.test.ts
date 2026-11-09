import { describe, it, expect, vi } from 'vitest';
import { mark_personal } from '../src/server/personal-response.ts';

describe('mark_personal', () => {
	it('a page made for one browser leaves every shared cache, whatever the app set', () => {
		const res = new Response('x', {
			headers: { 'cache-control': 'public, s-maxage=600', vary: 'Accept-Encoding' }
		});
		mark_personal(res);
		expect(res.headers.get('cache-control')).toBe('private, no-store');
		expect(res.headers.get('vary')).toBe('Accept-Encoding, Cookie');
	});
	it('an immutable response is left as it is', () => {
		const res = Response.redirect('http://app.test/', 302);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			expect(() => mark_personal(res)).not.toThrow();
		} finally {
			warn.mockRestore();
		}
	});
	// A page made for one browser that cannot be marked private may reach a shared cache, and with it
	// every visitor: that must be said, not dropped.
	it('an immutable response that cannot be marked private is said', () => {
		const said: unknown[][] = [];
		const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
			said.push(a);
		});
		try {
			mark_personal(Response.redirect('http://app.test/', 302));
		} finally {
			warn.mockRestore();
		}
		expect(said.some((a) => String(a[0]).includes('personal_response_unmarked'))).toBe(true);
	});
});
