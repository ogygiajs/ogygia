// On a csr=true route host Kit compiles and hydrates the page, so every region the host declares
// becomes the plain component: deferred, raw, lake and asRegion alike, server-driven ones included.
import { describe, expect, it } from 'vitest';
import { transformHost } from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const HOST = '/app/src/routes/kit/+page.svelte';

const ctx = (routeCsr: boolean) =>
	({
		...HOST_CTX_DEFAULTS,
		routeCsr,
		root: '/app',
		libDir: '/app/src/lib',
		readFile: () => null,
		dev: false,
		virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
		devUrlFor: (p: string) => `/@id/${p}`,
		visibleMargin: '0px',
		presets: {}
	}) as Parameters<typeof transformHost>[2];

const CASES: Array<[string, string, string]> = [
	[
		'a deferred render',
		`import W from './W.svelte' with { render: 'deferred' };`,
		`import W from './W.svelte';`
	],
	[
		'a raw region',
		`import W from './W.svelte' with { region: 'raw' };`,
		`import W from './W.svelte';`
	],
	['a lake', `import W from './W.svelte' with { wake: 'none' };`, `import W from './W.svelte';`],
	[
		'an asRegion with a deferred render',
		`import W from './W.svelte';\nconst D = import.meta.og.asRegion(W, { render: 'deferred' });`,
		`import W from './W.svelte';\nconst D = W;`
	],
	[
		'an asRegion lake',
		`import W from './W.svelte';\nconst D = import.meta.og.asRegion(W, { wake: 'none' });`,
		`import W from './W.svelte';\nconst D = W;`
	]
];

describe('a csr=true route host degrades every region to the plain component', () => {
	it.each(CASES)('%s', (_name, script, want) => {
		const src = dedent`
			<script>
			${script}
			</script>
			<W />
		`;
		const out = transformHost(src, HOST, ctx(true));
		expect(out).not.toBeNull();
		expect(out!.islands).toEqual([]);
		expect(out!.code).toBe(src.replace(script, want));
		// the same host on a csr=false page keeps its region
		expect(transformHost(src, HOST, ctx(false))!.islands.length).toBeGreaterThan(0);
	});
});
