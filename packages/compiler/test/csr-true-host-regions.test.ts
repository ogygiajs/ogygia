// A csr=true route host keeps the regions the server drives (a deferred hole, a held region, a lake,
// and the same through asRegion) exactly as a shared component does; only a wake island becomes the
// plain component Kit hydrates. The browser half: apps/palaestra/e2e/csr-true-regions.spec.ts.
import { describe, expect, it } from 'vitest';
import { dedent } from '@ogygia/core/contract';
import { transformHost } from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

const HOST = '/app/src/routes/kit/+page.svelte';

const ctx = (routeCsr: boolean | undefined) =>
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

const host = (script: string, markup: string) => dedent`
	<script>
	${script}
	</script>
	${markup}
`;

const SERVER_DRIVEN: Array<[string, string, string]> = [
	['a deferred hole', `import W from './W.svelte' with { render: 'deferred' };`, '<W />'],
	['a lake', `import W from './W.svelte' with { wake: 'none' };`, '<W />'],
	['a live region', `import W from './W.svelte' with { render: 'live' };`, '<W />'],
	[
		'a held region',
		`import W from './W.svelte' with { region: 'raw' };\nexport const regions = { W };`,
		''
	],
	[
		'an asRegion hole',
		`import W from './W.svelte';\nconst D = import.meta.og.asRegion(W, { render: 'deferred' });`,
		'<D />'
	],
	[
		'an asRegion lake',
		`import W from './W.svelte';\nconst D = import.meta.og.asRegion(W, { wake: 'none' });`,
		'<D />'
	],
	[
		'an asRegion held region',
		dedent`
			import W from './W.svelte';
			const D = import.meta.og.asRegion(W, { region: 'raw' });
			export const regions = { D };
		`,
		''
	]
];

describe('a csr=true route host keeps the regions the server drives, as a shared component does', () => {
	it.each(SERVER_DRIVEN)('%s', (_name, script, markup) => {
		const src = host(script, markup);
		const shared = transformHost(src, HOST, ctx(undefined));
		const page = transformHost(src, HOST, ctx(true));
		expect(shared?.islands.length).toBeGreaterThan(0);
		expect(page?.islands).toEqual(shared?.islands);
		expect(page?.code).toBe(shared?.code);
	});
});

describe('a csr=true route host hands its wake islands to Kit as plain components', () => {
	it('drops the wake import’s attributes and keeps the hole beside it', () => {
		const src = host(
			dedent`
				import C from './C.svelte' with { wake: 'load' };
				import H from './H.svelte' with { render: 'deferred' };
			`,
			'<C /><H />'
		);
		const page = transformHost(src, HOST, ctx(true))!;
		expect(page.code).toContain(`import C from './C.svelte';`);
		expect(page.islands.map((i: { strategy: string }) => i.strategy)).toEqual(['server']);
	});

	it('turns a wake asRegion into the component', () => {
		const src = host(
			dedent`
				import C from './C.svelte';
				const Live = import.meta.og.asRegion(C, { wake: 'visible' });
			`,
			'<Live />'
		);
		const page = transformHost(src, HOST, ctx(true))!;
		expect(page.code).toContain('const Live = C;');
		expect(page.islands).toEqual([]);
	});
});
