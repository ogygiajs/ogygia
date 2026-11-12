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
			let body = '';
			for (let i = 0; i < 60; i++) {
				body = `${body}\tconst v${i} = page.data.section${i % 15}?.items?.[${i}]?.title ?? page.data.fallback;\n`;
			}
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
	'pageKeys: record, settle and answer a build of components that hand the page to a helper',
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
