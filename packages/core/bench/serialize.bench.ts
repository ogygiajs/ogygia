// Server serialization: an island's props on the wire (the JSON and devalue lanes), the page seed
// and the references islands make into it, and the document tail that writes them all out. Per
// island and per page, on the palaestra's CMS page (twenty ~35 KB blocks, a ~300 KB header config).
import { bench } from '@bench/heisenbench/bench';
import { stringify } from 'devalue';
import { encode_island_graph, decode_island_graph } from '../src/island-graph.ts';
import { SeedIndex, plan_seed_refs, __heisenbench as seed_refs } from '../src/seed-refs.ts';
import { DocumentTail } from '../src/server/document-tail.ts';
import { region_fingerprint } from '../src/server/fingerprint.ts';
import { PageSeed } from '../src/server/page-seed.ts';
import { plan_props_wire, __heisenbench as props_wire } from '../src/server/props-wire.ts';
import { encode_region_props } from '../src/server/region-props.ts';
import { block, header, island_entry, page_of, page_tree, rich_block } from './fixtures.ts';

bench(
	'props wire: a CMS block on the JSON lane',
	({ props }) => plan_props_wire(props, 'block').wire(null),
	{
		setup: () => ({ props: block(3) })
	}
);

bench(
	'props wire: a block with a Date and a Map on the devalue lane',
	({ props }) => plan_props_wire(props, 'block').wire(null),
	{ setup: () => ({ props: rich_block(3) }) }
);

bench(
	'props wire: the header config (300 KB, not in the seed)',
	({ props }) => plan_props_wire(props, 'header').wire(null),
	{ setup: () => ({ props: header() }) }
);

bench(
	'props wire: live snippet entries in a devalue payload',
	({ text }) => props_wire.live_entries_in(text),
	{
		setup: () => {
			const parts: string[] = [];
			for (let i = 0; i < 200; i++) {
				parts.push(
					`"${'x'.repeat(400)}"`,
					`"${island_entry(i % 12)}"`,
					`"/docs/${i}/ogygia/og-region.x"`
				);
			}
			return { text: `[${parts.join(',')}]` };
		}
	}
);

bench('measure: the walk over a page.data tree', ({ tree }) => seed_refs.measure(tree, new Map()), {
	setup: () => ({ tree: page_of(4) }),
	scale: (_ctx, k) => ({ tree: page_of(4 * k) })
});

bench(
	'hash_subtree: structural hash of a page.data tree',
	({ tree }) => seed_refs.hash_subtree(tree, new Map(), new Set()),
	{
		setup: () => ({ tree: page_of(4) }),
		scale: (_ctx, k) => ({ tree: page_of(4 * k) })
	}
);

bench(
	'seed refs: twenty islands pass the seed its own blocks',
	({ data }) => {
		const index = new SeedIndex(data, 96);
		let count = 0;
		for (const b of data.catalog.blocks) count += plan_seed_refs(index, { block: b }).count;
		return count;
	},
	{ setup: () => ({ data: page_tree() }), scale: (_ctx, k) => ({ data: page_of(20 * k) }) }
);

bench(
	'seed refs: twenty islands pass clones, matched by structure',
	({ data, props }) => {
		const index = new SeedIndex(data, 96);
		let count = 0;
		for (const p of props) count += plan_seed_refs(index, p).count;
		return count;
	},
	{
		setup: () => clones_of(page_tree()),
		scale: (_ctx, k) => clones_of(page_of(20 * k))
	}
);

function clones_of(data: ReturnType<typeof page_tree>) {
	return { data, props: data.catalog.blocks.map((b) => ({ block: structuredClone(b) })) };
}

bench('page seed: the JSON lane', ({ page }) => PageSeed.serialize(page, stringify, true), {
	setup: () => ({
		page: {
			url: { href: 'https://example.test/catalog' },
			params: {},
			route: { id: '/catalog' },
			status: 200,
			data: page_of(4)
		}
	}),
	scale: (ctx, k) => ({ page: { ...ctx.page, data: page_of(4 * k) } })
});

bench('page seed: the devalue lane', ({ page }) => PageSeed.serialize(page, stringify, false), {
	setup: () => ({
		page: {
			url: { href: 'https://example.test/catalog' },
			params: { slug: 'catalog' },
			route: { id: '/[slug]' },
			status: 200,
			data: { ...page_tree(), updated: new Date(Date.UTC(2026, 8, 10)) }
		}
	}),
	scale: (ctx, k) => ({
		page: { ...ctx.page, data: { ...page_of(20 * k), updated: ctx.page.data.updated } }
	})
});

bench(
	'document tail: a CMS page (twenty block islands, the header, the seed)',
	({ data, header_props }) => {
		const tail = new DocumentTail();
		const islands: Array<[string, unknown]> = data.catalog.blocks.map((b, i) => [
			island_entry(i),
			{ block: b }
		]);
		islands.push([island_entry(99), header_props]);
		for (const [entry, props] of islands) {
			const plan = plan_props_wire(props, entry);
			const fp = region_fingerprint(entry, plan.canonical);
			tail.props(fp, plan);
			const hrefs = [
				`/_app/immutable/chunks/svelte.js`,
				`/_app/immutable/chunks/${fp.slice(0, 6)}.js`
			];
			tail.hints(hrefs, fp);
			tail.graph(entry, hrefs, fp);
		}
		tail.hole('h1', '/__ogygia__/r?id=1&p=abc', '');
		return tail.render(SeedIndex.of(data)).length;
	},
	{
		setup: () => ({ data: page_tree(), header_props: header() }),
		scale: (ctx, k) => ({ data: page_of(20 * k), header_props: ctx.header_props })
	}
);

bench(
	'region props: a hole’s props, devalue and base64url',
	({ props }) => encode_region_props(props),
	{ setup: () => ({ props: { product: block(2), at: new Date(Date.UTC(2026, 0, 1)) } }) }
);

bench(
	'island graph: forty entries encoded, then decoded',
	({ graph }) => decode_island_graph(encode_island_graph(graph)).size,
	{
		setup: () => {
			const graph = new Map<string, string[]>();
			for (let i = 0; i < 40; i++) {
				graph.set(
					island_entry(i),
					Array.from({ length: 12 }, (_, k) => `/_app/immutable/chunks/${(i * 3 + k) % 50}.js`)
				);
			}
			return { graph };
		}
	}
);
