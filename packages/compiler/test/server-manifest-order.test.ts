// The server manifest is a function of the set of server regions, not of the order the bundler
// transformed their hosts in: two builds of one app give the same server chunk bytes (#1399).
// Found by the compiler DST harness (internal/compiler-dst, topology: modules requested in a seeded
// order).
import { expect, test } from 'vitest';
import { Program } from '../src/compiler/program.ts';
import {
	server_manifest_module,
	server_regions_module
} from '../src/compiler/link/server-manifest.ts';

const hole = (id: string, host: string) => ({
	islands: [
		{
			id,
			kind: 'defer' as const,
			server: true,
			virtualPath: `ogygia:region/entry/${id}.js`,
			source: `export { default } from '/app/src/lib/${id}.svelte';\n`,
			componentPath: `/app/src/lib/${id}.svelte`,
			hostPath: host,
			renderId: `r-${id}`
		}
	]
});

function modules(order: readonly string[]): string[] {
	const program = new Program({ forms: true, router: true });
	for (const host of order)
		program.register(
			hole(host.includes('page') ? 'aaaa' : 'bbbb', host) as Parameters<Program['register']>[0],
			host
		);
	return [
		server_manifest_module(
			true,
			program,
			false,
			(v) => v,
			(iid) => `/_app/${iid}.js`
		),
		server_regions_module(true, program)
	];
}

test('the server manifest lists its regions the same whichever host registered last', () => {
	const PAGE = '/app/src/routes/+page.svelte';
	const LAYOUT = '/app/src/routes/+layout.svelte';
	expect(modules([LAYOUT, PAGE])).toEqual(modules([PAGE, LAYOUT]));
});
