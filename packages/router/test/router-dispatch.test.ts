/**
 * Router v2 dispatch — endpoints, params, verbs, base/slash, thrown redirect/error, miss, and the
 * load memoization + parent-sharing that makes waterfalls-and-waste impossible together. Page RENDER
 * (document/region) is covered by the router's e2e suite (e2e/); here we exercise the pure request→response
 * spine through endpoints and loads (no runtime needed).
 */
import { describe, it, expect } from 'vitest';
import { routes, load, redirect, error, layout, page } from '../src/index.ts';

const req = (path: string, init?: RequestInit) => new Request(`http://x${path}`, init);

describe('dispatch — endpoints, params, verbs', () => {
	const app = routes({
		'/': { GET: (c) => c.json({ home: true }) },
		'/docs/[slug]': { GET: (c) => c.json({ slug: c.params.slug }) },
		'/api/[id]': {
			GET: (c) => c.json({ read: c.params.id }),
			PUT: (c) => c.json({ put: c.params.id })
		},
		'/files/[...path]': { GET: (c) => c.json({ path: c.params.path }) }
	});

	it('routes GET endpoints with params ([slug], [...rest])', async () => {
		expect(await (await app.fetch(req('/')))!.json()).toEqual({ home: true });
		expect(await (await app.fetch(req('/docs/intro')))!.json()).toEqual({ slug: 'intro' });
		expect(await (await app.fetch(req('/files/a/b')))!.json()).toEqual({ path: 'a/b' });
	});

	it('falls through (null) on no match when unbased', async () => {
		expect(await app.fetch(req('/nope'))).toBeNull();
	});

	it('dispatches verbs, 405s the rest with allow, answers OPTIONS', async () => {
		expect(await (await app.fetch(req('/api/7')))!.json()).toEqual({ read: '7' });
		expect(await (await app.fetch(req('/api/7', { method: 'PUT' })))!.json()).toEqual({ put: '7' });
		const bad = await app.fetch(req('/api/7', { method: 'DELETE' }));
		expect(bad!.status).toBe(405);
		expect(bad!.headers.get('allow')).toBe('GET, PUT');
		const o = await app.fetch(req('/api/7', { method: 'OPTIONS' }));
		expect(o!.status).toBe(204);
		expect(o!.headers.get('allow')).toBe('GET, PUT');
	});
});

describe('dispatch — c.setHeaders reaches router-built responses', () => {
	// REGRESSION: Kit's `event.setHeaders` only affects `resolve()`-built responses; a
	// router-rendered Response bypassed it, so load/handler setHeaders silently vanished
	// (found when a mount load's Server-Timing header never reached the page).
	const app = routes({
		'/timed': {
			GET: (c) => {
				c.setHeaders?.({ 'Server-Timing': 'upstream;dur=12' });
				return c.json({ ok: true });
			}
		},
		'/explicit': {
			GET: (c) => {
				c.setHeaders?.({ 'x-a': 'from-setheaders' });
				// a handler's OWN Response headers must win over collected ones
				return new Response('{}', { headers: { 'x-a': 'explicit' } });
			}
		}
	});

	it('applies collected headers to the built response', async () => {
		const res = await app.fetch(req('/timed'));
		expect(res!.headers.get('server-timing')).toBe('upstream;dur=12');
		expect(await res!.json()).toEqual({ ok: true });
	});

	it('never clobbers headers the handler set explicitly', async () => {
		const res = await app.fetch(req('/explicit'));
		expect(res!.headers.get('x-a')).toBe('explicit');
	});
});

describe('dispatch — base, slash, miss', () => {
	const app = routes(
		{ '/x': { GET: (c) => c.json({ x: c.params }) } },
		{
			base: '/app',
			slash: 'never',
			miss: (c) => c.json({ missed: c.url.pathname }, { status: 404 })
		}
	);

	it('strips base, returns null for out-of-base', async () => {
		expect(await (await app.fetch(req('/app/x')))!.json()).toEqual({ x: {} });
		expect(await app.fetch(req('/other'))).toBeNull();
	});
	it('308-canonicalizes a trailing slash under slash:never', async () => {
		const r = await app.fetch(req('/app/x/'));
		expect(r!.status).toBe(308);
		expect(r!.headers.get('location')).toBe('/app/x');
	});
	it('runs miss for an unmatched path under base', async () => {
		const r = await app.fetch(req('/app/nope'));
		expect(r!.status).toBe(404);
		expect(await r!.json()).toEqual({ missed: '/app/nope' });
	});
});

describe('dispatch — the trailing-slash redirect stays on the site', () => {
	for (const [slash, path] of [
		['never', '//other.example/'],
		['always', '//other.example'],
		['always', '/\\other.example'],
		['never', '///other.example/x/']
	] as const) {
		it(`slash:${slash} on ${JSON.stringify(path)} redirects to a path on this host`, async () => {
			const app = routes({ '/': { GET: (c) => c.json({}) } }, { slash });
			const res = (await app.fetch(new Request(`http://site.test${path}`)))!;
			expect(res.status).toBe(308);
			const location = res.headers.get('location')!;
			expect(location).toMatch(/^\/(?![/\\])/);
			expect(location).not.toContain('\\');
			expect(new URL(location, 'http://site.test/').host).toBe('site.test');
		});
	}
});

describe('dispatch — thrown redirect / error', () => {
	const app = routes(
		{
			'/go': { GET: () => redirect(303, '/there') },
			'/boom': { GET: () => error(418, "I'm a teapot") },
			'/ok': { GET: (c) => c.json({ ok: true }) }
		},
		{ base: '/b' }
	);
	it('redirect() → a redirect response', async () => {
		const r = await app.fetch(req('/b/go'));
		expect(r!.status).toBe(303);
		expect(r!.headers.get('location')).toBe('/there');
	});
	it('error() from an endpoint → JSON error', async () => {
		const r = await app.fetch(req('/b/boom'));
		expect(r!.status).toBe(418);
		expect(await r!.json()).toEqual({ error: "I'm a teapot", status: 418 });
	});
});

describe('the table-wide load — a guard before every route', () => {
	it('its thrown redirect gates an endpoint too', async () => {
		const app = routes(
			{ '/api': { GET: (c) => c.json({ ok: true }) } },
			{
				load: (c) => {
					if (!c.url.searchParams.has('in')) redirect(303, '/login');
					return {};
				}
			}
		);
		expect((await app.fetch(req('/api')))!.status).toBe(303);
		expect((await app.fetch(req('/api?in')))!.status).toBe(200);
	});

	it('a Response it returns is the answer: the route never runs', async () => {
		let ran = false;
		const app = routes(
			{
				'/api': {
					GET: (c) => {
						ran = true;
						return c.json({ ok: true });
					}
				}
			},
			{ load: () => new Response('denied', { status: 403 }) }
		);
		const r = await app.fetch(req('/api'));
		expect(r!.status).toBe(403);
		expect(ran).toBe(false);
	});
});

describe('loads — memoization + parent-sharing (no waterfall, no waste)', () => {
	it('a shared load runs ONCE per request even when two loads await it', async () => {
		let runs = 0;
		const session = load(async () => {
			runs++;
			return { user: 'ada' };
		});
		// two endpoints in one request can't share; prove memo via one handler awaiting it twice + a
		// dependent load. Using an endpoint so we read the result directly.
		const app = routes({
			'/x': {
				GET: async (c) => {
					const a = await session(c);
					const b = await session(c); // same request → cache hit
					return c.json({ a, b, runs });
				}
			}
		});
		const r = await (await app.fetch(req('/x')))!.json();
		expect(r.runs).toBe(1);
		expect(r.a).toEqual({ user: 'ada' });
		expect(r.b).toEqual({ user: 'ada' });
	});

	it('memo is per-request (a second request re-runs)', async () => {
		let runs = 0;
		const l = load(async () => {
			runs++;
			return runs;
		});
		const app = routes({ '/x': { GET: async (c) => c.json(await l(c)) } });
		expect(await (await app.fetch(req('/x')))!.json()).toBe(1);
		expect(await (await app.fetch(req('/x')))!.json()).toBe(2);
	});
});

describe('entries — prerender param sets for dynamic patterns', () => {
	it('fills declared entries into the crawl list; undeclared dynamics are skipped', async () => {
		const { page } = await import('../src/index.ts');
		const { default: RawHtml } = await import('../src/RawHtml.svelte');
		const app = routes(
			{
				'/': page(RawHtml as never),
				'/posts/[id]': page(RawHtml as never, {
					entries: () => [{ id: '1' }, { id: '2' }]
				}),
				'/tags/[tag]': page(RawHtml as never) // dynamic, no entries → skipped
			},
			{ base: '/blog' }
		);
		const paths = (await app.entries()).map((e) => e.path).sort();
		expect(paths).toEqual(['/blog/', '/blog/posts/1', '/blog/posts/2']);
	});
});

describe('miss — HTML boundary for page requests', () => {
	// RawHtml stands in for an app error page — any real component works; the assertions are
	// about STATUS and CONTENT TYPE, the long-noted "miss answers JSON" gap.
	it('unmatched page GET under a base renders the root error page as HTML 404', async () => {
		const { default: RawHtml } = await import('../src/RawHtml.svelte');
		const app = routes(
			{ '/': { GET: (c) => c.json({ ok: true }) } },
			{ base: '/app', error: RawHtml as never }
		);
		const res = await app.fetch(
			new Request('http://x/app/nope', { headers: { accept: 'text/html,*/*' } })
		);
		expect(res!.status).toBe(404);
		expect(res!.headers.get('content-type')).toContain('text/html');
	});

	it('unmatched NON-HTML request keeps the JSON 404 (fetch/API callers)', async () => {
		const { default: RawHtml } = await import('../src/RawHtml.svelte');
		const app = routes(
			{ '/': { GET: (c) => c.json({ ok: true }) } },
			{ base: '/app', error: RawHtml as never }
		);
		const res = await app.fetch(
			new Request('http://x/app/nope', { headers: { accept: 'application/json' } })
		);
		expect(res!.status).toBe(404);
		expect(res!.headers.get('content-type')).not.toContain('text/html');
	});
});

describe('href — rename-safe links off the table keys', () => {
	const app = routes(
		{ '/docs/[slug]': { GET: (c) => c.text(c.params.slug ?? '') } },
		{ base: '/b' }
	);
	it('fills params + prefixes base', () => {
		expect(app.href('/docs/[slug]', { slug: 'intro' })).toBe('/b/docs/intro');
	});
});

describe('pages — the branch’s loads', () => {
	const html_of = async (app: { fetch: (r: Request) => Promise<Response | null> }, path: string) =>
		(await app.fetch(req(path, { headers: { accept: 'text/html' } })))!.text();

	it('the layouts’ and the page’s loads all run before any of them ends (no waterfall)', async () => {
		const { page, layout } = await import('../src/index.ts');
		const { default: Shell } = await import('./fixtures/Shell.svelte');
		let open!: () => void;
		const page_started = new Promise<void>((r) => (open = r));
		const shell = layout('shell', Shell as never, {
			// waits for the page's load to START: one after the other, this never ends
			load: async () => (await page_started, { from: 'layout' })
		});
		const app = routes(
			shell({
				'/p': page(
					async function* (_c: unknown, data: Record<string, unknown>) {
						yield `<p data-out>${String(data.from)}</p>`;
					},
					{ load: () => (open(), { page: true }) }
				)
			})
		);
		const out = await Promise.race([
			html_of(app, '/p'),
			new Promise<string>((r) => setTimeout(() => r('waterfall'), 1000))
		]);
		expect(out).toContain('<p data-out>layout</p>');
	});

	it('the loads’ data merges in branch order: the page’s wins over its layout’s', async () => {
		const { page, layout } = await import('../src/index.ts');
		const { default: Shell } = await import('./fixtures/Shell.svelte');
		const shell = layout('shell', Shell as never, { load: () => ({ who: 'layout', a: 1 }) });
		const app = routes(
			shell({
				'/p': page(
					async function* (_c: unknown, data: Record<string, unknown>) {
						yield `<p data-out>${String(data.who)}-${String(data.a)}</p>`;
					},
					{ load: () => ({ who: 'page' }) }
				)
			})
		);
		expect(await html_of(app, '/p')).toContain('<p data-out>page-1</p>');
	});

	it('a page load that returns a Response is the answer: nothing renders', async () => {
		const { page } = await import('../src/index.ts');
		let rendered = false;
		const app = routes({
			'/p': page(
				async function* () {
					rendered = true;
					yield '<p>page</p>';
				},
				{ load: () => new Response('denied', { status: 403 }) }
			)
		});
		const res = (await app.fetch(req('/p', { headers: { accept: 'text/html' } })))!;
		expect(res.status).toBe(403);
		expect(await res.text()).toBe('denied');
		expect(rendered).toBe(false);
	});
});

describe('pages — a thrown error finds its boundary', () => {
	/** /p under two layouts (shell outside inner), each with its own error page and load. */
	async function branch(over: {
		inner_load?: () => unknown;
		page_load?: () => unknown;
		action?: () => unknown;
		boundaries?: boolean;
	}) {
		const { page, layout } = await import('../src/index.ts');
		const { default: Shell } = await import('./fixtures/Shell.svelte');
		const { default: Inner } = await import('./fixtures/Inner.svelte');
		const { default: Oops } = await import('./fixtures/Oops.svelte');
		const err = over.boundaries === false ? {} : { error: Oops as never };
		const shell = layout('shell', Shell as never, { load: () => ({ s: 1 }), ...err });
		const inner = layout('inner', Inner as never, {
			load: over.inner_load ?? (() => ({ i: 1 })),
			...err
		});
		return routes(
			shell(
				inner({
					'/p': page(
						async function* () {
							yield '<p data-page>page</p>';
						},
						{
							load: over.page_load ?? (() => ({ p: 1 })),
							...(over.action ? { actions: { default: over.action } } : {})
						}
					)
				})
			)
		);
	}
	const get = (path: string) => req(path, { headers: { accept: 'text/html' } });
	/** The markup without Svelte's hydration markers. */
	const bare = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');

	it('a page load’s error renders the innermost error page inside every layout, with their data', async () => {
		const app = await branch({ page_load: async () => error(404, 'gone') });
		const res = (await app.fetch(get('/p')))!;
		const html = await res.text();
		expect(res.status).toBe(404);
		expect(bare(html)).toMatch(/<div data-shell[^>]*><section data-inner[^>]*><p data-oops/);
		expect(html).toContain('404 gone {"s":1,"i":1}');
	});

	it('a layout load’s error skips that layout’s own error page: the one above renders, without the failed layout', async () => {
		const app = await branch({ inner_load: async () => error(500, 'down') });
		const res = (await app.fetch(get('/p')))!;
		const html = await res.text();
		expect(res.status).toBe(500);
		expect(bare(html)).toMatch(/<div data-shell[^>]*><p data-oops/);
		expect(html).not.toContain('data-inner');
		// (every load that ended well gives its data, the page's too)
		expect(html).toContain('500 down {"s":1,"p":1}');
	});

	it('a layout load that throws synchronously is found as the failed layer too', async () => {
		const app = await branch({ inner_load: () => error(500, 'sync') });
		const html = await (await app.fetch(get('/p')))!.text();
		expect(html).not.toContain('data-inner');
		expect(html).toContain('500 sync');
	});

	it('an action’s error renders the innermost error page, every layout’s load having run', async () => {
		const app = await branch({ action: () => error(400, 'bad') });
		const res = (await app.fetch(req('/p', { method: 'POST', body: new FormData() })))!;
		const html = await res.text();
		expect(res.status).toBe(400);
		expect(bare(html)).toMatch(/<div data-shell[^>]*><section data-inner[^>]*><p data-oops/);
		expect(html).toContain('400 bad');
	});

	it('with no error page anywhere, a page’s error answers JSON', async () => {
		const app = await branch({ page_load: async () => error(404, 'gone'), boundaries: false });
		const res = (await app.fetch(get('/p')))!;
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'gone', status: 404 });
	});
});

describe('layout names — one name, one layout, across the table', () => {
	const A = (() => null) as never;
	const B = (() => null) as never;

	it('two different layouts with the same name throw when the table is built', () => {
		const one = layout('shell', A);
		const two = layout('shell', B);
		expect(() => routes({ ...one({ '/a': page(A) }), ...two({ '/b': page(B) }) })).toThrow(
			/share the name "shell"/
		);
	});

	it('the same layout reused under its one name is fine', () => {
		const shell = layout('shell', A);
		expect(() =>
			routes({ ...shell({ '/a': page(A) }), ...shell({ '/b': page(B) }) })
		).not.toThrow();
	});
});
