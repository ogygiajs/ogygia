// The compiler's per-file passes, the work a build does for every module: the island transform of a
// route component (its `with { wake }` imports, props and snippets), the page-data key analysis,
// the ownership stamps, the store macros, the de-barrel import / export analysis, and the free
// variables of an island's children.
import path from 'node:path';
import { parse } from 'svelte/compiler';
import { bench } from '@bench/heisenbench/bench';
import { EVERY_BARREL, ExportIndex, Shapes, type Policy } from '../src/compiler/exports/index.ts';
import { analyze_exports, analyze_imports } from '../src/compiler/exports/parse.ts';
import { barrel_left_table } from '../src/compiler/exports/left.ts';
import { BARREL_LEFT_REASONS } from '../src/contract/barrels.ts';
import { collect_flag_sites } from '../src/compiler/flags.ts';
import { collectFreeIdentifiers } from '../src/compiler/free-vars.ts';
import { page_data_keys_answer } from '../src/compiler/link/page-keys.ts';
import { auto_brand_stores, rewrite_store } from '../src/compiler/macros/store.ts';
import { stamp_opaque } from '../src/compiler/ownership-stamps.ts';
import { transformHost } from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from '../test/_host-ctx.ts';

type HostCtx = Parameters<typeof transformHost>[2];

const SVELTE = ['.svelte'];
const WAKES = ['load', 'visible', 'idle', 'interaction'];

function host_ctx(ssr: boolean): HostCtx {
	return {
		...HOST_CTX_DEFAULTS,
		ssr,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		pathModule: path,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		wrapperPathFor: (_host: string, iid: string) => `ogygia:region/wrapper/${iid}.svelte`,
		devUrlFor: (p: string) => '/@id/' + p,
		visibleMargin: '0px',
		presets: {}
	};
}

/** A route component: `islands` island imports, a few plain ones, and markup that uses them all. */
function route_page(islands: number): string {
	let script = `<script lang="ts">\n\timport Header from '$lib/Header.svelte';\n\timport { page } from '$app/state';\n\timport { format } from '$lib/format';\n`;
	for (let i = 0; i < islands; i++) {
		script += `\timport Block${i} from '$lib/blocks/Block${i}.svelte' with { wake: '${WAKES[i % 4]}' };\n`;
	}
	script += `\tlet { data } = $props();\n\tlet total = $derived(data.rows.reduce((n, r) => n + r.price, 0));\n\tfunction label(i: number): string {\n\t\treturn 'Row ' + i;\n\t}\n</script>\n\n`;
	let markup = `<Header title={data.title} />\n<main>\n`;
	for (let i = 0; i < islands; i++) {
		markup += `\t<section class="block">\n\t\t<h2>{label(${i})}</h2>\n\t\t<Block${i} rows={data.blocks[${i}].rows} title={data.blocks[${i}].title} locale={page.data.locale}>\n`;
		markup += `\t\t\t{#snippet footer(row)}<p>{format(row.price)} {total}</p>{/snippet}\n`;
		markup += `\t\t\t{#each data.blocks[${i}].tags as tag (tag)}<span>{tag}</span>{/each}\n\t\t</Block${i}>\n\t</section>\n`;
	}
	return script + markup + '</main>\n';
}

bench(
	'transformHost: a route page with twenty islands, server leg',
	({ source }) =>
		transformHost(source, '/app/src/routes/catalog/+page.svelte', host_ctx(true))?.code.length,
	{ setup: () => ({ source: route_page(20) }) }
);

// Growth from a small page: the transform is linear in the island count. It was quadratic while
// each marked import walked the whole file to learn whether it was used.
bench(
	'transformHost: a route page as its island count grows',
	({ source }) =>
		transformHost(source, '/app/src/routes/catalog/+page.svelte', host_ctx(true))?.code.length,
	{
		setup: () => ({ source: route_page(3) }),
		scale: (_ctx, k) => ({ source: route_page(3 * k) })
	}
);

bench(
	'transformHost: a route page with twenty islands, client leg',
	({ source }) =>
		transformHost(source, '/app/src/routes/catalog/+page.svelte', host_ctx(false))?.code.length,
	{ setup: () => ({ source: route_page(20) }) }
);

bench(
	'page data keys: which page.data keys a component reads',
	({ source }) => page_data_keys_answer(source, '/app/src/lib/Catalog.svelte', 'svelte').keys,
	{
		setup: () => {
			let body = '';
			for (let i = 0; i < 60; i++) {
				body += `\tconst v${i} = page.data.section${i % 15}?.items?.[${i}]?.title ?? page.data.fallback;\n`;
			}
			return {
				source: `<script lang="ts">\n\timport { page } from '$app/state';\n${body}</script>\n{#each page.data.list as item}<p>{item.name} {page.data.user?.name}</p>{/each}\n`
			};
		}
	}
);

bench(
	'ownership stamps: a component with custom elements and {@html}',
	({ source }) => stamp_opaque(source, '/app/src/lib/Widgets.svelte')?.length ?? 0,
	{
		setup: () => {
			let markup = '<script lang="ts">\n\tlet { items, html } = $props();\n</script>\n';
			for (let i = 0; i < 80; i++) {
				markup +=
					i % 4 === 0
						? `<x-widget id="w${i}">{@html html[${i}]}</x-widget>\n`
						: i % 4 === 1
							? `<div class="row"><p>{items[${i}].title}</p>{@html items[${i}].body}</div>\n`
							: `<demo-card class="c"><span slot="title">Card ${i}</span><p>{items[${i}].text}</p></demo-card>\n`;
			}
			return { source: markup };
		}
	}
);

bench(
	'store macros: import.meta.og.store marks and auto-branded stores',
	({ source }) =>
		auto_brand_stores(
			rewrite_store(source, 'src/lib/stores.ts', 'src/lib/stores.ts', SVELTE),
			'src/lib/stores.ts',
			'src/lib/stores.ts',
			SVELTE
		).length,
	{
		setup: () => {
			let src = `import { writable, readable, derived } from 'svelte/store';\n`;
			for (let i = 0; i < 30; i++) {
				src +=
					i % 3 === 0
						? `export const cart${i} = import.meta.og.store((seed = []) => ({ subscribe: writable(seed).subscribe, seed }));\n`
						: `export const count${i} = writable(${i});\nexport const doubled${i} = derived(count${i}, (n) => n * 2);\n`;
			}
			return { source: src };
		}
	}
);

bench(
	'de-barrel: the imports and exports of a barrel module',
	({ source }) =>
		(analyze_imports(source, '/app/src/lib/index.ts')?.length ?? 0) +
		(analyze_exports(source, '/app/src/lib/index.ts') ? 1 : 0),
	{
		setup: () => {
			let src = '';
			for (let i = 0; i < 150; i++) {
				src +=
					i % 3 === 0
						? `export { default as Widget${i} } from './widgets/Widget${i}.svelte';\n`
						: i % 3 === 1
							? `export * from './utils/util${i}.ts';\n`
							: `import { helper${i} } from './helpers/h${i}.ts';\nexport const use${i} = (x: number) => helper${i}(x) + ${i};\n`;
			}
			return { source: src };
		}
	}
);

/** A module declaring `flags` flags, each among a few lines of other code. */
function flags_module(flags: number): string {
	let src = `import { flag } from '@ogygia/flags';\nimport { format } from '$lib/format';\n\n`;
	for (let i = 0; i < flags; i++)
		src += `export const flag${i} = flag('flag-${i}', { a: 50, b: 50 });\nexport const label${i} = format('label ${i}');\n\n`;
	return src;
}

// Growth: the inventory is linear in the module's size. It was quadratic while each flag's line
// was counted from the top of the file.
bench(
	'flag inventory: the flag calls of a module as it grows',
	({ source }) => collect_flag_sites(source, '/app/src/lib/flags.ts', 'src/lib/flags.ts').length,
	{
		setup: () => ({ source: flags_module(20) }),
		scale: (_ctx, k) => ({ source: flags_module(20 * k) })
	}
);

/** `barrels` barrels of five leaves each under one top barrel, as in-memory files, and the host the
 *  barrel index reads them through (a relative resolve, every module a candidate). */
function barrel_tree(barrels: number) {
	const files = new Map<string, string>();
	for (let b = 0; b < barrels; b++) {
		for (let l = 0; l < 5; l++)
			files.set(`/app/lib/b${b}/l${l}.ts`, `export const n${b}_${l} = ${l};`);
		files.set(
			`/app/lib/b${b}/index.ts`,
			Array.from({ length: 5 }, (_, l) => `export * from './l${l}';`).join('\n')
		);
	}
	files.set(
		'/app/lib/index.ts',
		Array.from({ length: barrels }, (_, b) => `export * from './b${b}';`).join('\n')
	);
	// a barrel whose re-export cannot resolve at all (the host throws): its build fails
	files.set('/app/lib/broken.ts', `export { x } from './throws';`);
	const read = (id: string): string | null => files.get(id) ?? null;
	const resolve = async (spec: string, importer: string): Promise<string | null> => {
		if (spec === './throws') throw new Error('the resolver failed');
		const base = path.posix.join(path.posix.dirname(importer), spec);
		return files.has(`${base}.ts`)
			? `${base}.ts`
			: files.has(`${base}/index.ts`)
				? `${base}/index.ts`
				: null;
	};
	const policy: Policy = {
		candidate: () => true,
		forced: () => false,
		kept: () => false,
		follow_packages: false
	};
	return { files, read, resolve, policy };
}

// One build per barrel however many ask; an edit to a barrel while its map is being built drops that
// build (its callers build again), and an edit to a leaf after drops the kept maps that walked it.
bench(
	'the barrel index: every barrel asked at once, built once; an edit during and after the builds',
	async ({ barrels, read, resolve, policy }) => {
		const shapes = new Shapes(read);
		const index = new ExportIndex<void>(resolve, shapes);
		const asks: Promise<unknown>[] = [];
		for (let k = 0; k < barrels * 3; k++)
			asks.push(
				index.map(
					k % 3 === 0 ? '/app/lib/index.ts' : `/app/lib/b${k % barrels}/index.ts`,
					'x',
					policy
				)
			);
		shapes.invalidate('/app/lib/b0/index.ts');
		await Promise.all(asks);
		shapes.invalidate('/app/lib/b1/l1.ts');
		const top = await index.map('/app/lib/index.ts', 'x', policy);
		const broken = await index.map('/app/lib/broken.ts', 'x', policy).catch(() => null);
		return (top?.entries.size ?? 0) + (broken === null ? 0 : 1);
	},
	{
		setup: () => ({ barrels: 10, ...barrel_tree(10) }),
		scale: (_ctx, k) => ({ barrels: 10 * k, ...barrel_tree(10 * k) })
	}
);

// Two callers of one resolver (the CSS walk's policy and a pass's own) walk the same parsed and
// resolved graph: each barrel is parsed and resolved once, and mapped once per policy. A file added
// re-resolves; an edit re-walks only the maps that read it.
bench(
	'the export index: two policies over one graph, a file added and one edited',
	async ({ barrels, read, resolve, policy }) => {
		const shapes = new Shapes(read);
		const index = new ExportIndex<void>(resolve, shapes);
		let names = 0;
		for (const p of [policy, EVERY_BARREL])
			for (let b = 0; b < barrels; b++)
				names += (await index.map(`/app/lib/b${b}/index.ts`, 'x', p))?.entries.size ?? 0;
		shapes.invalidate('/app/lib/b2/l3.ts', 'create');
		shapes.invalidate('/app/lib/b1/l1.ts', 'update');
		for (const p of [policy, EVERY_BARREL])
			names += (await index.map('/app/lib/index.ts', 'x', p))?.entries.size ?? 0;
		return names;
	},
	{
		setup: () => ({ barrels: 10, ...barrel_tree(10) }),
		scale: (_ctx, k) => ({ barrels: 10 * k, ...barrel_tree(10 * k) })
	}
);

// Why a barrel stayed: a policy that keeps half the barrels and refuses the rest answers each with a
// map that says why; a leg's table records what every importer said, a re-transform forgets it, the
// rows join it by barrel and importers, and a full table drops what comes past its cap.
bench(
	'why a barrel stayed: the left maps, a leg of importers recorded, re-transforms, the join, the cap',
	async ({ barrels, read, resolve, policy }) => {
		const index = new ExportIndex<void>(resolve, new Shapes(read));
		const refusing: Policy = {
			...policy,
			kept: (id) => id.endsWith('0/index.ts'),
			candidate: (id) => !id.endsWith('1/index.ts')
		};
		const table = barrel_left_table(barrels * 2);
		for (let i = 0; i < barrels * 4; i++) {
			const barrel = `/app/lib/b${i % barrels}/index.ts`;
			const map = await index.map(barrel, 'x', refusing);
			const importer = `/app/src/I${i}.svelte`;
			table.forget(importer);
			if (map?.left) table.record(importer, map.id, map.left);
			table.record(importer, barrel, BARREL_LEFT_REASONS[i % BARREL_LEFT_REASONS.length]);
			if (i % 7 === 0) table.record(importer, null, 'unparsable');
		}
		for (let i = 0; i < barrels; i += 3) table.forget(`/app/src/I${i}.svelte`);
		let reasons = 0;
		for (let b = 0; b < barrels; b++)
			reasons += table.why(`/app/lib/b${b}/index.ts`, [`/app/src/I${b}.svelte?v=1`]).length;
		for (let i = 0; i < barrels * 3; i++)
			table.record(`/app/src/J${i}.ts`, `/app/lib/extra${i}.ts`, 'impure');
		const size = table.size;
		table.clear();
		return reasons + size + table.size;
	},
	{
		setup: () => ({ barrels: 10, ...barrel_tree(10) }),
		scale: (_ctx, k) => ({ barrels: 10 * k, ...barrel_tree(10 * k) })
	}
);

bench(
	'free variables: what an island’s children read from the host',
	({ nodes }) => collectFreeIdentifiers(nodes).size,
	{
		setup: () => {
			const ast = parse(route_page(20), { modern: true });
			return { nodes: ast.fragment.nodes as Parameters<typeof collectFreeIdentifiers>[0] };
		}
	}
);
