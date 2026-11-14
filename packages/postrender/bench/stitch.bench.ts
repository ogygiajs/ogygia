// Post-render serving: finding the stitch holes in a stored page, rewriting edge holes into ESI
// includes, stitching rendered holes back in, and the in-memory page store a site serves from
// (hits, writes, a subtree purge and a tag purge).
import { bench } from '@bench/heisenbench/bench';
import { MemoryStore } from '../src/memory-store.ts';
import { esi_rewrite, find_stitch_holes, stitch_html, stitch_modes } from '../src/stitch.ts';
import type { PostrenderEntry } from '../src/types.ts';

/** A stored page: `regions` regions, every fourth a stitch hole (serve or edge), some nested. */
function page(regions: number): string {
	const body: string[] = [];
	for (let i = 0; i < regions; i++) {
		const inner = `<article><h2>Item ${i}</h2><p>${'Fresh from the store. '.repeat(10)}</p></article>`;
		if (i % 4 === 0) {
			const mode = i % 8 === 0 ? 'edge' : 'serve';
			body.push(
				`<ogygia-region entry="" render="defer" when="load" stitch="${mode}" endpoint="/__ogygia__/r?id=${i}&amp;p=${i * 31}"><ogygia-region entry="/_app/ogygia/og-region.${i}.js" wake="visible">${inner}</ogygia-region></ogygia-region>`
			);
		} else {
			body.push(
				`<ogygia-region entry="/_app/ogygia/og-region.${i}.js" wake="visible">${inner}</ogygia-region>`
			);
		}
	}
	return `<!doctype html><html><head><title>Catalog</title></head><body>${body.join('')}</body></html>`;
}

bench(
	'stitch holes: find them in a stored page',
	({ html }) => find_stitch_holes(html).length + Number(stitch_modes(html).edge),
	{
		setup: () => ({ html: page(200) }),
		scale: (_ctx, k) => ({ html: page(200 * k) })
	}
);

bench(
	'esi_rewrite: edge holes into ESI includes',
	({ html }) => esi_rewrite(html, '/catalog/').length,
	{
		setup: () => ({ html: page(200) }),
		scale: (_ctx, k) => ({ html: page(200 * k) })
	}
);

bench(
	'stitch_html: splice fifty rendered holes into the page',
	async ({ html }) =>
		(await stitch_html(html, async (endpoint) => `<p data-from="${endpoint}">rendered</p>`)).length,
	{
		setup: () => ({ html: page(200) }),
		scale: (_ctx, k) => ({ html: page(200 * k) })
	}
);

const entry = (i: number): PostrenderEntry => ({
	kind: 'page',
	html: `<html><head></head><body>${'x'.repeat(2000 + i)}</body></html>`,
	headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' },
	created: 0
});

bench(
	'memory store: a burst of hits and writes, a subtree purge, a tag purge',
	async ({ entries }) => {
		const store = new MemoryStore(500, 8_000_000);
		for (let i = 0; i < entries.length; i++) {
			await store.put(`/shop/${i % 3}/item-${i}/`, entries[i], {
				ttl: 60,
				tags: [`cat-${i % 10}`]
			});
		}
		let hits = 0;
		for (let i = 0; i < 1000; i++)
			if (await store.get(`/shop/${i % 3}/item-${(i * 7) % 400}/`)) hits++;
		await store.evictWhere({ prefix: '/shop/1/' });
		const gone = await store.evictByTag('cat-3');
		return hits + gone.length;
	},
	{ setup: () => ({ entries: Array.from({ length: 400 }, (_, i) => entry(i)) }) }
);
