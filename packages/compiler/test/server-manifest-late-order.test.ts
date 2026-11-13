// The server manifest's maps and loaders, written at the end of the server leg, are a function of
// the set of server regions, not of the order the bundler transformed their hosts in: two builds of
// one app give the same server chunk bytes (#1399, here for the values a build relocates: #1421).
import { expect, test } from 'vitest';
import { Program } from '../src/compiler/program.ts';
import {
	LATE_SERVER_REGIONS_TOKEN,
	PAGE_DATA_READS_TOKEN,
	server_manifest_maps,
	server_regions_module
} from '../src/compiler/link/server-manifest.ts';
import {
	relocate as relocate_table,
	relocations_of,
	type RelocateCx
} from '../src/compiler/link/relocations.ts';

const relocate = (code: string, c: RelocateCx) =>
	relocate_table(code, relocations_of(true), new Map(), c)?.s.toString() ?? '';

const PAGE = '/app/src/routes/+page.svelte';
const LAYOUT = '/app/src/routes/+layout.svelte';
const ID: Record<string, string> = { [PAGE]: 'aaaaaaaaaaaa', [LAYOUT]: 'bbbbbbbbbbbb' };

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

function program_of(order: readonly string[]): Program {
	const program = new Program({ forms: true, router: true });
	for (const host of order)
		program.register(hole(ID[host], host) as Parameters<Program['register']>[0], host);
	return program;
}

function cx(program: Program, order: readonly string[]): RelocateCx {
	return {
		program,
		dollar_hoists: new Map(),
		public_url: (iid) => `/_app/${iid}.js`,
		late_server_regions: new Map(order.map((host) => [ID[host], `ref-${ID[host]}`])),
		chunk_file: 'chunks/manifest.js',
		file_name: (ref) => `chunks/regions/${ref}.js`,
		facade_file: () => undefined,
		graph: () => null,
		module_ids: () => []
	};
}

/** Everything the server leg writes about its server regions, for hosts registered in `order`. */
function written(order: readonly string[]): string[] {
	const program = program_of(order);
	const c = cx(program, order);
	return [
		JSON.stringify(server_manifest_maps(program, (iid) => `/_app/${iid}.js`)),
		server_regions_module(true, program, true),
		relocate(`r = {...${LATE_SERVER_REGIONS_TOKEN}};`, c),
		relocate(`p = "${PAGE_DATA_READS_TOKEN}";`, c)
	];
}

test("the server leg's maps, loaders and late loaders are the same whichever host registered last", () => {
	expect(written([LAYOUT, PAGE])).toEqual(written([PAGE, LAYOUT]));
});
