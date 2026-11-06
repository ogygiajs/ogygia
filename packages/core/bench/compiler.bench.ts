// The compiler's per-file passes, the work a build does for every module: the island transform of a
// route component (its `with { wake }` imports, props and snippets), the page-data key analysis,
// the ownership stamps, the store macros, the de-barrel import / export analysis, and the free
// variables of an island's children.
import path from 'node:path';
import { parse } from 'svelte/compiler';
import { bench } from '@bench/abax/bench';
import { analyze_exports, analyze_imports } from '../src/compiler/debarrel/parse.ts';
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
		virtualPathFor: (_host: string, iid: string) => `virtual:ogygia/island/${iid}.js`,
		wrapperPathFor: (_host: string, iid: string) => `virtual:ogygia/wrapper/${iid}.svelte`,
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
	{
		setup: () => ({ source: route_page(20) }),
		scale: (_ctx, k) => ({ source: route_page(20 * k) })
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
