/**
 * The app's `transport` types reach everything ogygia serializes from a request: the page seed, the
 * remote seed, and the page facts of a render for a page (a remote call, a hole). SvelteKit 2 also
 * kept that transport on its private request state; SvelteKit 3 does not, so on Kit 3 a value of a
 * custom type broke each of them. The app's transport comes from its own hooks file
 * (`ogygia:region`), the same on both Kits.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as devalue from 'devalue';
import { with_request_store } from '@sveltejs/kit/internal/server';
import { transport } from 'ogygia:region/transport';

const { handle } = await import('../src/hooks.ts');
const { kit_page_ready, kit_page_facts_tail } = await import('../src/server/kit-context.ts');
const { record_page } = await import('../src/page-seed-registry.ts');

class Money {
	cents: number;
	constructor(cents: number) {
		this.cents = cents;
	}
}
const MONEY = {
	encode: (v: unknown) => v instanceof Money && v.cents,
	decode: (c: unknown) => new Money(c as number)
};

const KITS = [
	['SvelteKit 2 (the transport also on its request state)', { transport: { Money: MONEY } }],
	['SvelteKit 3 (no transport on its request state)', {}]
] as const;

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

const kit_data = (data: Record<string, unknown>) =>
	`${JSON.stringify({
		type: 'data',
		nodes: [
			{ type: 'data', data: JSON.parse(devalue.stringify(data, { Money: MONEY.encode })), uses: {} }
		]
	})}\n`;

const event_at = (path: string, over: object = {}) => {
	const url = new URL(`https://a.test${path}`);
	return {
		url,
		request: new Request(url, { headers: { referer: 'https://a.test/shop' } }),
		getClientAddress: () => '203.0.113.7',
		params: {},
		route: { id: null },
		isDataRequest: false,
		cookies: { get: () => undefined },
		locals: {},
		platform: undefined,
		setHeaders() {},
		...over
	};
};

/** A Kit page request as Kit runs it (test/request-bag.test.ts): the handle in Kit's store, the
 *  render in a store of its own, the page transform after it. */
async function page(state: object, render: () => void): Promise<string> {
	const event = event_at('/p');
	let html = '';
	await with_request_store({ event, state } as never, () =>
		handle()({
			event: event as never,
			resolve: async (ev, opts) => {
				with_request_store({ event: { ...ev }, state } as never, render);
				html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		})
	);
	return html;
}

afterEach(() => {
	delete (transport as Record<string, unknown>).Money;
});

describe("the app's transport, on every Kit", () => {
	it.each(KITS)(
		'a page.data value of a custom type ships in the page seed, on %s',
		async (_, s) => {
			(transport as Record<string, unknown>).Money = MONEY;
			const html = await page(s, () => record_page({ data: { price: new Money(250) } }, 'all'));
			expect(/<script type="application\/ogygia-page"[^>]*>([^<]*)</.exec(html)?.[1]).toContain(
				'"Money"'
			);
		}
	);

	it.each(KITS)(
		"a remote's result of a custom type ships in the remote seed, on %s",
		async (_, s) => {
			(transport as Record<string, unknown>).Money = MONEY;
			const state = {
				...s,
				remote: {
					implicit: new Map([[{ id: 'h1/one', type: 'query' }, { '': () => new Money(250) }]])
				}
			};
			const html = await page(state, () => record_page({ data: {} }, false, null));
			expect(/<script type="application\/ogygia-remote"[^>]*>([^<]*)</.exec(html)?.[1]).toContain(
				'"Money"'
			);
		}
	);

	it.each(KITS)(
		"a page value of a custom type reaches a remote call's answer, encoded, on %s",
		async (_, state) => {
			(transport as Record<string, unknown>).Money = MONEY;
			const event = event_at('/_app/remote/abc/header', {
				isRemoteRequest: true,
				fetch: async () =>
					new Response(kit_data({ price: new Money(250) }), {
						headers: { 'content-type': 'text/sveltekit-data' }
					})
			});
			const tail = await with_request_store({ event, state } as never, async () => {
				await kit_page_ready(true);
				record_page({}, ['price']);
				return kit_page_facts_tail();
			});
			expect(tail).toContain('"Money"');
			expect(tail).toContain('250');
		}
	);
});
