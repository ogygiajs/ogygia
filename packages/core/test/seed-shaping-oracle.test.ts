/**
 * SEED SHAPING'S ORACLE (rules builds and dev): what the build's `pageKeys()` answer said must hold
 * at run time. A render whose page look-up was skipped (its tree "reads no page.data") reads no key
 * of it (`rule_hole_page_read_unpredicted`); a shaped page seed names the keys it left out, so the
 * browser can tell when island code reads one (`rule_seed_key_unshipped`).
 */
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { install_server_rules, server_rules } from '../src/server/rules.ts';
import { prepare_render_page, render_page } from '../src/server/render-page.ts';
import { unshipped_attr, unshipped_keys } from '../src/server/seed-shape.ts';

install_server_rules();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A remote call rendering for the page at its Referer. */
function remote_event(): RequestEvent {
	return {
		url: new URL('https://a.test/_app/remote/abc/header'),
		request: new Request('https://a.test/_app/remote/abc/header', {
			headers: { referer: 'https://a.test/p/alpha' }
		}),
		params: {},
		route: { id: null },
		isRemoteRequest: true,
		fetch: async () => new Response(''),
		cookies: { get: () => undefined }
	} as unknown as RequestEvent;
}

describe('a render whose page look-up the build skipped', () => {
	it('reads no page.data key, or a rule breaks naming the key and the page', async () => {
		const event = remote_event();
		await prepare_render_page(event, undefined, false);
		const page = render_page({}, event)! as { data: Record<string, unknown> };
		expect(server_rules.broken()).toEqual([]);
		// (a thenable check is no read)
		expect((page.data as { then?: unknown }).then).toBeUndefined();
		expect(page.data.user).toBeUndefined();
		await tick();
		expect(server_rules.broken()).toEqual([
			{ code: 'rule_hole_page_read_unpredicted', detail: 'page.data.user on /p/alpha' }
		]);
	});
});

describe('the keys a shaped seed leaves out', () => {
	it('are named, sorted; a seed shipped whole names none', () => {
		const data = { b: 1, a: 2, kept: 3 };
		expect(unshipped_keys(data, new Set(['kept']))).toEqual(['a', 'b']);
		expect(unshipped_keys(data, 'all')).toEqual([]);
		expect(unshipped_keys(data, null)).toEqual([]);
		expect(unshipped_keys([1], new Set())).toEqual([]);
		expect(unshipped_attr(data, new Set(['a', 'b', 'kept']))).toBe('');
		expect(unshipped_attr({ 'x"<': 1 }, new Set())).toBe(
			' data-ogygia-page-unshipped="[&quot;x\\&quot;&lt;&quot;]"'
		);
	});
});
