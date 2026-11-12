// What a site reads per request (its context, its mount, its policies) and what its remotes send.
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import type { RequestEvent } from '@sveltejs/kit';
import { content } from '../src/index.ts';
import type { Heading, Source, SourceEntry } from '../src/index.ts';
import { site, type EmitHandler } from '../src/site/site.ts';
import { dimensions } from '../src/site/dimensions.ts';
import { remotes } from '../src/site/server.ts';
import type { NavGroup, NavLeaf, NavTree } from '../src/site/types.ts';

type Meta = { headings: Heading[] };

function fromArray(entries: SourceEntry<Meta>[]): Source<Meta> {
	const map = new Map(entries.map((e) => [e.id, e]));
	return { get: async (id) => map.get(id) ?? null, refs: async () => entries.slice() };
}

const page = (id: string, n: number, data: Record<string, unknown>, extra = {}) =>
	({
		id,
		filePath: `content/docs/00-start/0${n}-${id}/+doc.svx`,
		order: [0, n],
		data,
		meta: { headings: [] },
		...extra
	}) as unknown as SourceEntry<Meta>;

const schema = v.object({ title: v.string(), draft: v.optional(v.boolean(), false) });

/** install, usage, and a draft only a preview sees. */
const docs = () =>
	content({
		loader: fromArray([
			page('install', 0, { title: 'Install' }),
			page('usage', 1, { title: 'Usage' }),
			page('secret', 2, { title: 'Secret', draft: true })
		]),
		schema,
		filter: (e, ctx) => !e.data.draft || ctx.preview === true
	});

const event = (path: string, slug: string) => ({
	params: { slug },
	url: new URL(`https://x.dev${path}`)
});
const status = (p: Promise<unknown>) =>
	p.then(
		() => 200,
		(e: { status?: number }) => e.status ?? 500
	);
const titles = (tree: NavTree) =>
	tree.flatMap((n) =>
		n.kind === 'group'
			? (n as NavGroup).items.filter((l): l is NavLeaf => l.kind === 'leaf').map((l) => l.title)
			: n.kind === 'leaf'
				? [n.title]
				: []
	);

describe('a site read per request', () => {
	it('load and entries work detached from the site, as a route file destructures them', async () => {
		const { load, entries } = site({ outline: docs() });
		expect((await entries()).map((e) => e.slug)).toEqual(['install', 'usage']);
		expect(await status(load(event('/install', 'install')))).toBe(200);
	});

	it('load reads the page in the context the request derives (a draft under preview)', async () => {
		const s = site({
			outline: docs(),
			context: ({ url }) => ({ preview: url.searchParams.has('preview') })
		});
		expect(await status(s.load(event('/secret', 'secret')))).toBe(404);
		expect(await status(s.load(event('/secret?preview', 'secret')))).toBe(200);
	});

	it('a context that throws reads the public projection', async () => {
		const s = site({
			outline: docs(),
			context: () => {
				throw new Error('no session');
			}
		});
		expect(await status(s.load(event('/install', 'install')))).toBe(200);
		expect(await status(s.load(event('/secret?preview', 'secret')))).toBe(404);
	});

	it('a page whose meta has no headings has none', async () => {
		const s = site({
			outline: content({
				loader: fromArray([page('install', 0, { title: 'Install' }, { meta: undefined })]),
				schema
			})
		});
		expect((await s.page('install'))?.headings).toEqual([]);
	});

	it("prevNext 'order' suggests the next page, false suggests nothing", async () => {
		const order = await site({ outline: docs(), prevNext: 'order' }).page('install');
		expect(order?.trail.suggested.map((r) => r.slug)).toEqual(['usage']);
		const none = await site({ outline: docs(), prevNext: false }).page('install');
		expect(none?.trail.suggested).toEqual([]);
		expect(none?.trail.next?.slug).toBe('usage');
	});

	it("an emission handler is a Kit GET handler (it takes Kit's RequestEvent)", async () => {
		const handler: EmitHandler = site({ outline: docs() }).emit.sitemap({
			origin: 'https://x.dev'
		});
		const get: (event: RequestEvent) => Promise<Response> = handler;
		const res = await get({ url: new URL('https://x.dev/sitemap.xml') } as RequestEvent);
		expect(await res.text()).toContain('https://x.dev/install');
	});
});

describe('a site’s remotes', () => {
	const en = () =>
		content({ loader: fromArray([page('install', 0, { title: 'Install en' })]), schema });
	const fr = () =>
		content({ loader: fromArray([page('install', 0, { title: 'Install fr' })]), schema });
	const localized = () =>
		site({
			outline: dimensions({
				axes: { locale: { values: ['en', 'fr'], default: 'en', label: 'Language' } },
				resolve: ({ locale }) => (locale === 'fr' ? fr() : en())
			})
		});

	it('nav and meta serve the coordinate the slug names; no slug is the default', async () => {
		const r = remotes(localized(), { base: '/docs' });
		expect(titles(await r.nav())).toEqual(['Install en']);
		expect(titles(await r.nav('fr/install'))).toEqual(['Install fr']);
		expect(titles((await r.meta('fr/install')).nav)).toEqual(['Install fr']);
		expect((await r.meta('fr/install')).switcher).not.toBeNull();
	});

	it('a page crosses without its source reader, and with its body awaited', async () => {
		const body = { html: '<p>Run the installer.</p>' };
		const s = site({
			outline: content({
				loader: fromArray([
					page(
						'install',
						0,
						{ title: 'Install' },
						{
							source: async () => '# Install',
							body: Promise.resolve(body)
						}
					)
				]),
				schema
			})
		});
		const view = await remotes(s).page('install');
		expect(view?.entry).not.toHaveProperty('source');
		expect(view?.entry.body).toEqual(body);
		expect(await remotes(s).page('nope')).toBeNull();
	});
});
