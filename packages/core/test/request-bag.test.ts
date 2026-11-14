import { describe, expect, it } from 'vitest';
import { with_request_store } from '@sveltejs/kit/internal/server';

const { handle } = await import('../src/hooks.ts');
const { record_ctx } = await import('../src/context-registry.ts');
const { record_page, open_ask_scope, read_seed_ask } = await import('../src/page-seed-registry.ts');
const { open_late_scope, register_late_region, take_late_regions } =
	await import('../src/late-region-registry.ts');
const { mint, register_kind } = await import('../src/ref.ts');
const { requestEvent } = await import('../src/request-event.ts');
const { current_facts } = await import('../src/plugin/facts.ts');
const { record_source_read } = await import('../src/source.ts');
const { document_tail } = await import('../src/server/document-tail.ts');

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

const event_for = (u: URL) =>
	({
		url: u,
		request: new Request(u),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	}) as never as { request: Request; url: URL };

/** A Kit page request as Kit runs it: the handle inside Kit's request store, the render inside a
 *  NEW store of its own (Kit's `render_response` wraps it in `{ event, state }` with a traced copy
 *  of the event), the page transform after the render. `render` runs where a Region's SSR would. */
async function page(render: () => void, state: object = {}): Promise<string> {
	const event = event_for(new URL('https://app.test/p'));
	let html = '';
	await with_request_store({ event, state } as never, () =>
		handle()({
			event: event as never,
			resolve: async (ev, opts) => {
				with_request_store({ event: { ...ev }, state: {} } as never, render);
				html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		})
	);
	return html;
}

describe("a Kit page's request bag", () => {
	it('a context a layout sets during the render reaches the page as one provide-page script', async () => {
		const html = await page(() => {
			record_page({ data: {} }, false);
			record_ctx('theme', 'dark');
			record_ctx('user', { name: 'ada' });
		});
		expect(html.match(/data-ogygia-provide-page/g)?.length).toBe(1);
		expect(html).toContain('dark');
		expect(html).toContain('ada');
	});

	it('a region that reads no page ships no page seed', async () => {
		const html = await page(() => record_page({ data: { a: 'AAA' } }, false));
		expect(html).not.toContain('application/ogygia-page');
		expect(html).not.toContain('AAA');
	});

	it('a page seed ships only the page.data keys the regions read', async () => {
		const html = await page(() => {
			record_page({ data: { a: 'AAA', b: 'BBB', c: 'CCC' } }, ['a']);
			record_page({ data: { a: 'AAA', b: 'BBB', c: 'CCC' } }, ['b']);
		});
		expect(html).toContain('AAA');
		expect(html).toContain('BBB');
		expect(html).not.toContain('CCC');
	});

	it("a region's page record keeps what an earlier record set, and adds to it", async () => {
		const html = await page(() => {
			record_page({ data: { a: 'AAA' }, status: 201 }, 'all');
			record_page({ form: { f: 'FFF' } }, false);
		});
		expect(html).toContain('AAA');
		expect(html).toContain('FFF');
	});

	describe('the remote seed', () => {
		const remotes = () => ({
			remote: {
				implicit: new Map([
					[{ id: 'h1/one', type: 'query' }, { '': () => 'ONE' }],
					[{ id: 'h2/two', type: 'query' }, { '': () => 'TWO' }]
				])
			}
		});

		it('ships only the remotes some region on the page can call', async () => {
			const html = await page(() => {
				record_page({ data: {} }, false, ['h1']);
				record_page({ data: {} }, false, []);
			}, remotes());
			expect(html).toContain('ONE');
			expect(html).not.toContain('TWO');
		});

		it('ships the remotes every region can call, together', async () => {
			const html = await page(() => {
				record_page({ data: {} }, false, ['h1']);
				record_page({ data: {} }, false, ['h2']);
			}, remotes());
			expect(html).toContain('ONE');
			expect(html).toContain('TWO');
		});

		it('ships every remote once one region may call any, whatever the others name', async () => {
			const html = await page(() => {
				record_page({ data: {} }, false, ['h1']);
				record_page({ data: {} }, false, null);
				record_page({ data: {} }, false, []);
			}, remotes());
			expect(html).toContain('ONE');
			expect(html).toContain('TWO');
		});
	});

	it('the requestEvent a region reads during the render is the Kit event of its request', async () => {
		let seen: unknown;
		await page(() => {
			record_page({ data: {} }, false);
			seen = requestEvent<{ url: URL }>()?.url.pathname;
		});
		expect(seen).toBe('/p');
	});

	it("a data source read during the render is filed with the request's facts, when a plugin asked", async () => {
		let sources: string[] | undefined;
		await page(() => {
			const facts = current_facts()!;
			facts.sources = [];
			record_source_read('s:a:1');
			sources = facts.sources;
		});
		expect(sources).toEqual(['s:a:1']);
	});

	describe('a side-channel script holds whatever the page carries, without ending early', () => {
		const BREAK = '</script><img src=x onerror=alert(1)>';
		const broke = (html: string) => html.includes('</script><img');

		it('in a context value', async () => {
			const html = await page(() => {
				record_page({ data: {} }, false);
				record_ctx('k', BREAK);
			});
			expect(html).toContain('data-ogygia-provide-page');
			expect(broke(html)).toBe(false);
		});

		it('in page.data', async () => {
			const html = await page(() => record_page({ data: { a: BREAK } }, 'all'));
			expect(html).toContain('application/ogygia-page');
			expect(broke(html)).toBe(false);
		});

		it("in a remote's result", async () => {
			const html = await page(() => record_page({ data: {} }, false, null), {
				remote: { implicit: new Map([[{ id: 'h1/one', type: 'query' }, { '': () => BREAK }]]) }
			});
			expect(html).toContain('application/ogygia-remote');
			expect(broke(html)).toBe(false);
		});
	});

	it("a page's render shares one document tail; a render outside a Kit page has none", async () => {
		const tails: unknown[] = [];
		await page(() => {
			record_page({ data: {} }, false);
			tails.push(document_tail(), document_tail());
		});
		expect(tails[0]).not.toBe(null);
		expect(tails[0]).toBe(tails[1]);
		with_request_store(
			{ event: event_for(new URL('https://app.test/__ogygia__')), state: {} } as never,
			() => expect(document_tail()).toBe(null)
		);
	});

	it("a Kit page's asks so far read back from its bag", async () => {
		let read: unknown;
		await page(() => {
			record_page({ data: { a: 1 } }, ['a']);
			read = read_seed_ask();
		});
		expect(read).toEqual({ wanted: true, keys: new Set(['a']) });
	});

	it('a csr=false page with a region tells the runtime so in its head', async () => {
		const html = await page(() => record_page({ data: {} }, false));
		expect(html).toContain('<meta name="ogygia-csr" content="false">');
	});

	it('a late region registered after a drain still lands in the next drain', async () => {
		let first: unknown,
			second: unknown,
			ids: (string | null)[] = [];
		await page(() => {
			open_late_scope();
			ids.push(register_late_region(Promise.resolve(1)));
			first = take_late_regions()?.map((r) => r.id);
			ids.push(register_late_region(Promise.resolve(2)));
			second = take_late_regions()?.map((r) => r.id);
		});
		expect(ids).toEqual(['r0', 'r1']);
		expect(first).toEqual(['r0']);
		expect(second).toEqual(['r1']);
	});

	it('no late region is kept on a page that opened no late scope', async () => {
		let id: string | null = 'x';
		await page(() => {
			id = register_late_region(Promise.resolve(1));
		});
		expect(id).toBe(null);
	});
});

describe("the server router's document asks", () => {
	const run = (fn: () => void) =>
		with_request_store({ event: event_for(new URL('https://app.test/r')), state: {} } as never, fn);

	it('a document that opened its ask scope reads back the keys its regions asked for', () => {
		let read: unknown;
		run(() => {
			open_ask_scope();
			record_page({ data: { a: 1 } }, ['a']);
			read = read_seed_ask();
		});
		expect(read).toEqual({ wanted: true, keys: new Set(['a']) });
	});

	it('a document whose regions read no page reads back no ask', () => {
		let read: unknown;
		run(() => {
			open_ask_scope();
			record_page({ data: { a: 1 } }, false);
			read = read_seed_ask();
		});
		expect(read).toEqual({ wanted: false, keys: null });
	});

	it('a render with no ask scope and no page reads back nothing', () => {
		let read: unknown = 'x';
		run(() => {
			record_page({ data: { a: 1 } }, ['a']);
			read = read_seed_ask();
		});
		expect(read).toBe(undefined);
	});
});

describe("a request's ref names", () => {
	it('one instance is one name within a request, and two requests never share a name', () => {
		register_kind({
			k: 'test-bag-named',
			match: (v) => typeof v === 'object' && v !== null && 'bag_named' in v,
			encode: () => ({ d: 0 }),
			decode: () => ({ bag_named: true })
		});
		const o = { bag_named: true };
		const names: (string | undefined)[] = [];
		for (let i = 0; i < 2; i++)
			with_request_store(
				{ event: event_for(new URL(`https://app.test/${i}`)), state: {} } as never,
				() => names.push(mint(o)?.i, mint(o)?.i)
			);
		expect(names[0]).toBeTypeOf('string');
		expect(names[0]).toBe(names[1]);
		expect(names[2]).toBe(names[3]);
		expect(names[0]).not.toBe(names[2]);
	});
});
