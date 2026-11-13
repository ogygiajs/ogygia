/**
 * A BATCH OF HOLES IS ONE REQUEST (#1682): one hole in it skips its page look-up (the build said its
 * tree reads no `page.data`), another asks for it. The one that asked reads `page.data` as the build
 * said it would, whatever the look-up answered: the rule judges the renders the build skipped, never
 * one that asked.
 */
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { install_server_rules, server_rules } from '../src/server/rules.ts';
import { prepare_render_page, render_page } from '../src/server/render-page.ts';

install_server_rules();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A batch POST to the islands endpoint, for the page at its Referer; its page's data is down. */
function batch_event(): RequestEvent {
	return {
		url: new URL('https://a.test/__ogygia__'),
		request: new Request('https://a.test/__ogygia__', {
			method: 'POST',
			headers: { referer: 'https://a.test/p2' }
		}),
		params: {},
		route: { id: null },
		fetch: async () => new Response('down', { status: 503 }),
		cookies: { get: () => undefined }
	} as unknown as RequestEvent;
}

describe('a batch where one hole skips the page look-up and the next asks for it', () => {
	it('lets the hole that asked read page.data with no rule broken, even when the look-up found nothing', async () => {
		const event = batch_event();
		// the layout's hole: its tree reads no page.data
		await prepare_render_page(event, undefined, false);
		// a hole whose tree reads page.data.who: it asks, and its page's data is unavailable
		await prepare_render_page(event, undefined, true);
		const page = render_page({}, event)! as { data: Record<string, unknown> };
		expect(page.data.who).toBeUndefined();
		await tick();
		expect(server_rules.broken()).toEqual([]);
	});
});
