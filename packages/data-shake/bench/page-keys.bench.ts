// Seed shaping per module, the work a build does for every module that imports the page: the
// analysis of a component with many reads, and the plugin's own record, settle and answer over a
// set of modules that hand the page to an imported helper.
import { bench } from '@bench/heisenbench/bench';
import { dedent } from '@ogygia/core/contract';
import { page_data_keys_answer } from '../src/analysis.ts';
import { page_reads } from '../src/index.ts';

bench(
	'page data keys: which page.data keys a component reads',
	({ source }) => page_data_keys_answer(source, '/app/src/lib/Catalog.svelte', 'svelte').keys,
	{
		setup: () => {
			const lines: string[] = [];
			for (let i = 0; i < 60; i++) {
				lines.push(
					`\tconst v${i} = page.data.section${i % 15}?.items?.[${i}]?.title ?? page.data.fallback;\n`
				);
			}
			const body = lines.join('');
			return {
				source: `${dedent`
					<script lang="ts">
						import { page } from '$app/state';
					${body}</script>
					{#each page.data.list as item}<p>{item.name} {page.data.user?.name}</p>{/each}
				`}\n`
			};
		}
	}
);

/** A script module that reads the page through its own helpers and the store helpers, `k` times
 *  over, with names shadowed by params, patterns, loops, catch clauses and blocks. */
function page_helpers_module(k: number): string {
	const parts = [
		`import { get, derived } from 'svelte/store';`,
		`import { page } from '$app/stores';`,
		`function lang(p) { return p.data.lang; }`,
		`const title = (p) => p.data.title;`
	];
	for (let i = 0; i < k; i++)
		parts.push(
			`export const l${i} = lang(get(page));`,
			`export const t${i} = derived(page, ($page) => title($page) + $page.data.s${i});`,
			`export function f${i}({ get, b: [lang], ...rest }, title = 1) { return get(page) + lang(page) + title; }`,
			`export function g${i}(xs) { for (const [get] of xs) get(page); for (let derived = 0; derived < 1; derived++) {} try { lang(get(page)); } catch (title) { title(page); } { const lang = 1; } return 0; }`
		);
	return parts.join('\n');
}

bench(
	"page data keys: a module's own page helpers and the store helpers, shadowed and not",
	({ source }) => page_data_keys_answer(source, '/app/src/lib/page-helpers.ts', 'script').keys,
	{
		setup: () => ({ source: page_helpers_module(5) }),
		scale: (_ctx, k) => ({ source: page_helpers_module(5 * k) })
	}
);

/** `n` components that read a key each and hand the page to one helper, the helper, and a dev ask. */
function app(n: number) {
	const files = new Map<string, string>();
	files.set('/app/src/lib/lang.ts', 'export function lang(p) { return p.data._locale; }');
	for (let i = 0; i < n; i++)
		files.set(
			`/app/src/lib/C${i}.svelte`,
			dedent`
				<script>
					import { page } from '$app/state';
					import { lang } from '$lib/lang';
				</script>
				<p>{page.data.k${i}} {lang(page)}</p>
			`
		);
	return files;
}

bench(
	'dataShake: record, settle and answer a build of components that hand the page to a helper',
	async ({ files }) => {
		const r = page_reads((f) => files.get(f) ?? null);
		for (const [id, code] of files) r.module(id, code);
		await r.settle(async () => ({ id: '/app/src/lib/lang.ts' }));
		let n = 0;
		for (const id of files.keys()) {
			const k = r.keys(id);
			if (k !== null && k !== 'unknown') n += k.size;
			if (r.why(id)) n++;
		}
		const dev = await r.dev([...files.keys()], async () => ({ id: '/app/src/lib/lang.ts' }));
		return n + (dev.keys?.length ?? 0);
	},
	{ setup: () => ({ files: app(12) }) }
);
