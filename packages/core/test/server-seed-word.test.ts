// THE SEEDS BY THE BUILD'S WORD: a csr=false page carries a side-channel for its islands only where
// the build's runtime has the feature that reads it (`ogygia:server/runtime-flags`, the browser's
// `HAS`): the page seed (`page`: and the sidecars written against it), the remote seed
// (`remote-seeds`) and the drop-in context root (`context`). Whatever the server writes, the
// runtime the same build ships can revive; a feature left out of the word writes nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { with_request_store } from '@sveltejs/kit/internal/server';
import { HAS, set_server_word } from './_stubs/server.runtime-flags.ts';
import { F_CONTEXT, F_PAGE, F_REMOTE_SEEDS } from '../src/contract/features.ts';
import { set_kit_public_env } from './_stubs/server.kit-env.ts';

const { handle } = await import('../src/hooks.ts');
const { record_ctx, page_context_script } = await import('../src/context-registry.ts');
const { record_page, read_seed_ask } = await import('../src/page-seed-registry.ts');
const { document_tail } = await import('../src/server/document-tail.ts');
const { PropsWire } = await import('../src/server/props-wire.ts');
const { SEED_REF_KEY } = await import('../src/seed-ref-reviver.ts');
const { PAGE_DEFER_BOOTSTRAP } = await import('../src/page-defer.ts');

const ALL = HAS;
afterEach(() => set_server_word(ALL));

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

/** A Kit page request as Kit runs it (see request-bag.test.ts): `render` runs where a Region's SSR
 *  would, the page transform after it. */
async function page(
	render: () => void,
	state: object = {},
	headers: Record<string, string> = {}
): Promise<string> {
	const u = new URL('https://app.test/p');
	const event = {
		url: u,
		request: new Request(u, { headers }),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	};
	let html = '';
	let read: unknown;
	await with_request_store({ event, state } as never, () =>
		handle()({
			event: event as never,
			resolve: async (ev, opts) => {
				with_request_store({ event: { ...ev }, state: {} } as never, () => {
					render();
					read = page_context_script();
				});
				html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		})
	);
	contexts.push(read as string);
	return html;
}
const contexts: string[] = [];

/** A block whose props are a node of the page's data (big enough to be sent as a reference). */
const block = {
	id: 'hero',
	title: 'A hero block',
	body: 'Some words about the page. '.repeat(40),
	links: Array.from({ length: 8 }, (_, i) => ({ href: `/a/${i}`, label: `Link ${i}` }))
};
const data = { blocks: [block], footer: 'FOOTER' };

/** An island whose client reads the page, its props a node of `page.data`. */
function island_reading_page(): void {
	record_page({ data }, 'all');
	document_tail()!.props('fp1', new PropsWire(block, '/islands/hero.js'));
}

const without = (bit: number) => set_server_word(ALL & ~bit);

describe('the page seed', () => {
	it('with the page feature: it ships, and the sidecar points into it', async () => {
		const html = await page(island_reading_page);
		expect(html).toContain('application/ogygia-page');
		expect(html).toContain(SEED_REF_KEY);
	});

	it('without it: no seed, and the sidecar carries its props whole', async () => {
		without(F_PAGE);
		const html = await page(island_reading_page);
		expect(html).not.toContain('application/ogygia-page');
		expect(html).not.toContain(SEED_REF_KEY);
		expect(html).toContain('application/ogygia-props');
		expect(html).toContain('A hero block');
	});

	it('without it: a streamed load stages nothing for the browser', async () => {
		without(F_PAGE);
		const streamed = () => record_page({ data: { later: new Promise(() => {}) } }, 'all');
		const html = await page(streamed, {}, { 'sec-fetch-mode': 'navigate' });
		expect(html).not.toContain(PAGE_DEFER_BOOTSTRAP);
		expect(html).not.toContain('application/ogygia-page');
	});

	it('with it: a streamed load stages its promise for the browser', async () => {
		const streamed = () => record_page({ data: { later: new Promise(() => {}) } }, 'all');
		const html = await page(streamed, {}, { 'sec-fetch-mode': 'navigate' });
		expect(html).toContain(PAGE_DEFER_BOOTSTRAP);
	});

	it("without it: a document's asks read back as none (no document seed)", async () => {
		without(F_PAGE);
		let read: unknown;
		await page(() => {
			record_page({ data: { a: 1 } }, ['a']);
			read = read_seed_ask();
		});
		expect(read).toEqual({ wanted: false, keys: null, env: false });
	});
});

describe("a held region's document()", () => {
	const page_state = {
		url: { href: 'http://x/a' },
		params: {},
		route: { id: '/a' },
		status: 200,
		data: { site: 'A SITE NAME' }
	};
	const doc = async () => {
		const { document } = await import('../src/document.ts');
		const { region } = await import('../src/region.ts');
		const { default: Tiny } = await import('./_fixtures/Tiny.svelte');
		return (
			await document(region(Tiny as never, { n: 1 } as never), { pageState: page_state })
		).text();
	};

	it('with the page feature: outside a request the handle owns, the whole page seed ships', async () => {
		expect(await doc()).toContain('application/ogygia-page');
	});

	it('without it: no page seed, even outside a request the handle owns', async () => {
		without(F_PAGE);
		const html = await doc();
		expect(html).not.toContain('application/ogygia-page');
		expect(html).not.toContain('A SITE NAME');
	});
});

describe('the remote seed', () => {
	const remotes = () => ({
		remote: { implicit: new Map([[{ id: 'h1/one', type: 'query' }, { '': () => 'ONE' }]]) }
	});
	const calls_any = () => record_page({ data: {} }, false, null);

	it('with the remote-seeds feature: the remotes the render resolved ship', async () => {
		const html = await page(calls_any, remotes());
		expect(html).toContain('application/ogygia-remote');
		expect(html).toContain('ONE');
	});

	it('without it: none ships', async () => {
		without(F_REMOTE_SEEDS);
		const html = await page(calls_any, remotes());
		expect(html).not.toContain('application/ogygia-remote');
		expect(html).not.toContain('ONE');
	});
});

describe("Kit's public env (KIT-PUBLIC-ENV)", () => {
	const reads_env = () => record_page({ data: {} }, false, [], '/islands/env.js', true);
	const reads_none = () => record_page({ data: {} }, false, [], '/islands/plain.js', false);
	afterEach(() => set_kit_public_env(null));

	it('a page whose region imports it carries what Kit renders, marked as the response', async () => {
		set_kit_public_env({ PUBLIC_REGION: 'eu</script>' });
		const html = await page(reads_env);
		const script =
			/<script type="application\/ogygia-env" data-og-mark="([^"]+)">([^<]*)<\/script>/.exec(html);
		expect(script, html).not.toBeNull();
		expect(html).toContain(`data-og-mark="${script![1]}"`);
		expect((await import('devalue')).parse(script![2]!)).toEqual({ PUBLIC_REGION: 'eu</script>' });
	});

	it('a page whose regions never import it carries none', async () => {
		set_kit_public_env({ PUBLIC_REGION: 'eu' });
		expect(await page(reads_none)).not.toContain('application/ogygia-env');
	});

	it('none ships where Kit has no dynamic public variable, or no env ogygia reads (Kit 2)', async () => {
		set_kit_public_env({});
		expect(await page(reads_env)).not.toContain('application/ogygia-env');
		set_kit_public_env(null);
		expect(await page(reads_env)).not.toContain('application/ogygia-env');
	});

	it('without the page feature: a region that imports it and reads no page still gets it', async () => {
		without(F_PAGE);
		set_kit_public_env({ PUBLIC_REGION: 'eu' });
		const html = await page(reads_env);
		expect(html).toContain('application/ogygia-env');
		expect(html).not.toContain('application/ogygia-page');
	});

	it('a streamed page whose region imports it carries it', async () => {
		set_kit_public_env({ PUBLIC_REGION: 'eu' });
		const streamed = () =>
			record_page({ data: { later: new Promise(() => {}) } }, 'all', [], '/islands/env.js', true);
		const html = await page(streamed, {}, { 'sec-fetch-mode': 'navigate' });
		expect(html).toContain(PAGE_DEFER_BOOTSTRAP);
		expect(html).toContain('application/ogygia-env');
	});

	it("a router page's document() whose region imports it carries it, marked as the response", async () => {
		set_kit_public_env({ PUBLIC_REGION: 'eu' });
		const { document } = await import('../src/document.ts');
		const { region } = await import('../src/region.ts');
		const { default: ReadsKitEnv } = await import('./_fixtures/ReadsKitEnv.svelte');
		let html = '';
		const u = new URL('https://app.test/r');
		const event = { url: u, request: new Request(u), route: { id: null }, params: {}, locals: {} };
		await with_request_store({ event, state: {} } as never, async () => {
			html = await (
				await document(region(ReadsKitEnv as never, {} as never), {
					pageState: { url: { href: u.href }, params: {}, route: { id: '/r' } }
				})
			).text();
		});
		const runtime = /<script data-og-mark="([^"]+)"[^>]*data-ogygia-runtime/.exec(html);
		const env = /<script type="application\/ogygia-env" data-og-mark="([^"]+)">/.exec(html);
		expect(env, html).not.toBeNull();
		expect(env![1]).toBe(runtime?.[1]);
	});

	it('a region rendered for a page (a server hole, a remote call) carries it in its answer when an island in it imports it', async () => {
		set_kit_public_env({ PUBLIC_REGION: 'eu' });
		const { kit_page_facts_tail } = await import('../src/server/kit-context.ts');
		const answer = (url: string, remote: boolean, render: () => void): string => {
			const u = new URL(url);
			const event = {
				url: u,
				request: new Request(u, { headers: { referer: 'https://app.test/p' } }),
				isRemoteRequest: remote,
				route: { id: null },
				params: {},
				locals: {}
			};
			let tail = '';
			with_request_store({ event, state: {} } as never, () => {
				render();
				tail = kit_page_facts_tail();
			});
			return tail;
		};
		for (const [url, remote] of [
			['https://app.test/__ogygia__?id=hole', false],
			['https://app.test/_app/remote/abc/header', true]
		] as const) {
			const env = /<script type="application\/ogygia-env"[^>]*>([^<]*)<\/script>/.exec(
				answer(url, remote, reads_env)
			);
			expect(env, url).not.toBeNull();
			expect((await import('devalue')).parse(env![1]!)).toEqual({ PUBLIC_REGION: 'eu' });
			expect(answer(url, remote, reads_none), url).not.toContain('application/ogygia-env');
		}
	});

	it('an edited variable ships its new value on the next page, though Kit writes it into the same object', async () => {
		const env: Record<string, unknown> = { PUBLIC_REGION: 'eu' };
		set_kit_public_env(env);
		expect(await page(reads_env)).toContain('eu');
		env.PUBLIC_REGION = 'edited';
		const html = await page(reads_env);
		expect(html).toContain('edited');
		expect(html).not.toContain('"eu"');
	});

	it('a value devalue cannot carry ships nothing, and says kit_env_unshipped', async () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			set_kit_public_env({ PUBLIC_FN: () => 1 });
			expect(await page(reads_env)).not.toContain('application/ogygia-env');
			expect(warned.mock.calls.flat().join(' ')).toContain('kit_env_unshipped');
		} finally {
			warned.mockRestore();
		}
	});
});

describe('the context root', () => {
	const sets_context = () => {
		record_page({ data: {} }, false);
		record_ctx('theme', 'dark-theme');
	};

	it('with the context feature: what the render set ships, and a document reads it', async () => {
		contexts.length = 0;
		const html = await page(sets_context);
		expect(html).toContain('data-ogygia-provide-page');
		expect(html).toContain('dark-theme');
		expect(contexts[0]).toContain('dark-theme');
	});

	// (a document's reader is installed with the recorder, when the handle's module loads with the
	// feature in its word: this module loaded with every feature)
	it('without it: nothing ships', async () => {
		without(F_CONTEXT);
		const html = await page(sets_context);
		expect(html).not.toContain('data-ogygia-provide-page');
		expect(html).not.toContain('dark-theme');
	});
});
