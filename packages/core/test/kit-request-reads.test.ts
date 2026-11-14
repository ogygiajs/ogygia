/**
 * What ogygia reads of Kit's live request, pinned before and after the move off Kit's private
 * request store onto `getRequestEvent()` (#1724): the same answers inside a Kit request, after an
 * await in it, and outside any request.
 */
import { describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { with_request_store } from '@sveltejs/kit/internal/server';

await import('../src/hooks.ts');
const { kit_request_event, kit_page_facts_tail } = await import('../src/server/kit-context.ts');
const { requestEvent } = await import('../src/request-event.ts');
const { current_request } = await import('../src/plugin/facts.ts');
const { record_ctx } = await import('../src/context-registry.ts');
const { record_page } = await import('../src/page-seed-registry.ts');
const { document } = await import('../src/document.ts');
const { region } = await import('../src/region.ts');
const { default: PageProbe } = await import('./_fixtures/PageProbe.svelte');

const event_at = (path: string) => {
	const url = new URL(`https://app.test${path}`);
	return {
		url,
		request: new Request(url),
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		locals: {},
		platform: undefined,
		setHeaders() {}
	};
};

const in_kit = <T>(event: object, fn: () => T): T =>
	with_request_store({ event, state: {} } as never, fn);

const probe_text = async (res: Response) =>
	/<p data-probe="">([^<]*)<\/p>/.exec(await res.text())?.[1];

describe("what ogygia reads of Kit's live request", () => {
	it("inside a Kit request every reader answers that request's event", () => {
		const event = event_at('/live');
		in_kit(event, () => {
			expect(kit_request_event()).toBe(event);
			expect(requestEvent()).toBe(event);
			expect(current_request()).toBe(event.request);
		});
	});

	it('after an await inside a Kit request the readers still answer it', async () => {
		const event = event_at('/later');
		await in_kit(event, async () => {
			await new Promise((r) => setTimeout(r, 1));
			expect(kit_request_event()).toBe(event);
			expect(current_request()).toBe(event.request);
		});
	});

	it('outside any Kit request every reader answers null, and recording throws nothing', () => {
		expect(kit_request_event()).toBeNull();
		expect(requestEvent()).toBeNull();
		expect(current_request()).toBeUndefined();
		expect(kit_page_facts_tail()).toBe('');
		expect(() => record_ctx('k', 1)).not.toThrow();
		expect(() => record_page({ data: {} }, false)).not.toThrow();
	});

	it('document() inside a Kit request renders the page URL of that request', async () => {
		const res = await in_kit(event_at('/from/request'), () =>
			document(region(PageProbe as unknown as Component, {} as never))
		);
		expect(await probe_text(res)).toBe('200|/from/request|-|{}');
	});

	it('document() outside any Kit request renders a page with no URL', async () => {
		const res = await document(region(PageProbe as unknown as Component, {} as never));
		expect(await probe_text(res)).toBe('200|-|-|{}');
	});
});
