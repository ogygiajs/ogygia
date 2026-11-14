// A marked import keys the region on the binding it imports (`<specifier>#<export>`); a namespace
// import names no export, so a mark on one is refused in both host kinds rather than minting a region.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import { transformHost, transformTsRegions } from '../src/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type Ctx = Parameters<typeof transformHost>[2];
const CTX = {
	...HOST_CTX_DEFAULTS,
	root: '/app',
	libDir: '/app/src/lib',
	readFile: () => null,
	dev: false,
	virtualPathFor: (_host: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	devUrlFor: (p: string) => `/@id/${p}`,
	visibleMargin: '0px',
	presets: {},
	pathModule: path
} as Ctx;

const NOT_NAMESPACE = /region_import_namespace|A namespace is not a component/;

describe('a region mark on a namespace import is refused', () => {
	it('in a .svelte host', () => {
		const src = dedent`
			<script>
			import * as Lib from '$lib/index.ts' with { wake: 'load' };
			</script>
			<Lib.Card />
		`;
		expect(() => transformHost(src, '/app/src/routes/+page.svelte', CTX)).toThrow(NOT_NAMESPACE);
	});

	it('in a .ts module', () => {
		const src = dedent`
			import * as Lib from '$lib/index.ts' with { wake: 'load' };
			export { Lib };
		`;
		expect(() => transformTsRegions(src, '/app/src/lib/regions.ts', CTX)).toThrow(NOT_NAMESPACE);
	});

	it.each([
		["import { Card } from '$lib/index.ts' with { wake: 'load' };", 'Card', /#Card$/],
		["import { Card as C } from '$lib/index.ts' with { wake: 'load' };", 'C', /#Card$/],
		[
			"import Card from '$lib/Card.svelte' with { wake: 'load' };",
			'Card',
			/^src\/lib\/Card\.svelte$/
		]
	])('%s binds the export it names', (imp, local, component) => {
		const src = dedent`
			${imp}
			export { ${local} };
		`;
		const out = transformTsRegions(src, '/app/src/lib/regions.ts', CTX)!;
		// identity is `<component>\0<strategy>`
		expect(out.islands[0].identity!.split('\0')[0]).toMatch(component);
	});
});
