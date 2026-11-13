// A HOLE PAYS THE PAGE LOOKUP ONLY WHEN ITS TREE READS `page.data` (link/relocations.ts,
// server/render-page.ts): the server manifest's placeholder is patched, once the graph is complete,
// with each server island's answer over its component's static AND dynamic imports.
import { describe, test, expect } from 'vitest';
import { CompileCtx, Compiler, Program, normalize_import_keys } from '../dist/compiler/index.js';
import { partial_ctx_init } from './_compile-ctx.ts';

// the manifest's placeholder as the server manifest emits it (a string literal no bundler folds)
const PLACEHOLDER =
	'(() => { try { return JSON.parse("__OGYGIA_PAGE_DATA_READS__"); } catch { return null; } })()';
/** The value the patched placeholder evaluates to. */
const value_of = (code: string): unknown => new Function(`return ${code};`)();

function compiler_with(holes: Record<string, string>, reads: Record<string, Set<string> | 'all'>) {
	const program = new Program({ forms: true, router: true });
	for (const [iid, component] of Object.entries(holes)) {
		const vp = `\0ogygia:region/entry/${iid}`;
		program.by_id.set(iid, vp);
		program.registry.set(vp, { server: true, componentPath: component } as never);
	}
	for (const [id, keys] of Object.entries(reads)) program.page_keys.set(id, keys);
	const profiler = {
		prof: {
			transformMs: 0,
			transformN: 0,
			transformHit: 0,
			prescanMs: 0,
			bakeMs: 0,
			bakeN: 0,
			resolveMs: 0,
			loadMs: 0
		},
		P: false,
		outHash: new Map<string, number>()
	};
	// (the patch reads the program and the graph, never the context)
	const ctx = new CompileCtx(
		partial_ctx_init({
			root: '/app',
			presets: {},
			import_keys: normalize_import_keys(undefined),
			resolve_alias: []
		})
	);
	return new Compiler(program, profiler, ctx);
}

describe('the page-data reads relocation', () => {
	const graph: Record<string, { importedIds: string[]; dynamicallyImportedIds: string[] }> = {
		'/app/Header.svelte': {
			importedIds: ['/app/Nav.svelte'],
			dynamicallyImportedIds: ['/app/blocks/Promo.svelte']
		},
		'/app/Nav.svelte': { importedIds: ['/app/util.ts'], dynamicallyImportedIds: [] },
		'/app/util.ts': { importedIds: [], dynamicallyImportedIds: [] },
		'/app/blocks/Promo.svelte': { importedIds: [], dynamicallyImportedIds: [] },
		'/app/Footer.svelte': {
			importedIds: ['/app/util.ts', '/app/Url.svelte'],
			dynamicallyImportedIds: []
		},
		'/app/Url.svelte': { importedIds: ['/app/Footer.svelte'], dynamicallyImportedIds: [] }
	};
	const info = (id: string) => graph[id] ?? null;
	const ids = () => Object.keys(graph);
	const bundle = { graph: info, module_ids: ids, chunk_file: 'manifest.js', file_name: String };
	const server_leg = () => ({
		server: true,
		relocated: new Map<string, number>(),
		late_server_regions: new Map<string, string>()
	});

	test('a reader anywhere in the tree (a dynamic import too) → true; none (a cycle too) → false', () => {
		const c = compiler_with(
			{ aaaaaaaaaaaa: '/app/Header.svelte', bbbbbbbbbbbb: '/app/Footer.svelte' },
			// Promo reads a key; Url reads the page but only its url (an empty key set)
			{ '/app/blocks/Promo.svelte': new Set(['_locale']), '/app/Url.svelte': new Set() }
		);
		const out = c.relocate(PLACEHOLDER, server_leg(), bundle);
		expect(value_of(out!.code)).toEqual({ aaaaaaaaaaaa: true, bbbbbbbbbbbb: false });
	});

	test('an unpinnable read (`all`) counts; a component the graph does not know looks up', () => {
		const c = compiler_with(
			{ cccccccccccc: '/app/Nav.svelte', dddddddddddd: '/app/Gone.svelte' },
			{ '/app/util.ts': 'all' }
		);
		// (a bundler that re-quoted the literal with single quotes)
		const out = c.relocate(PLACEHOLDER.split('"').join("'"), server_leg(), bundle);
		expect(value_of(out!.code)).toEqual({ cccccccccccc: true, dddddddddddd: true });
	});

	test('unpatched (a build that never reached renderChunk), it is unknown: null', () => {
		expect(value_of(PLACEHOLDER)).toBeNull();
	});

	test('a chunk without the placeholder is left alone', () => {
		expect(compiler_with({}, {}).relocate('export {}', server_leg(), bundle)).toBeNull();
	});
});

// A module that imports Kit's page and recorded no keys is a reader seed shaping could not read:
// a `$lib` barrel that re-exports `page`, a `getStores()` call, an `import('$app/state')`. The
// hole looks up, as an island ships all of `page.data` for a reader it saw no keys for.
describe('the page-data relocation: a page reader seed shaping could not read', () => {
	const KIT_STATE = '/app/node_modules/@sveltejs/kit/src/runtime/app/state/index.js';
	const KIT_STORES = '/app/node_modules/@sveltejs/kit/src/runtime/app/stores.js';
	const graph: Record<string, { importedIds: string[]; dynamicallyImportedIds: string[] }> = {
		'/app/Hole.svelte': { importedIds: ['/app/lib/stores.ts'], dynamicallyImportedIds: [] },
		'/app/lib/stores.ts': { importedIds: [KIT_STATE], dynamicallyImportedIds: [] },
		'/app/Stores.svelte': { importedIds: [KIT_STORES], dynamicallyImportedIds: [] },
		'/app/Lazy.svelte': { importedIds: [], dynamicallyImportedIds: [KIT_STATE] },
		'/app/UrlOnly.svelte': { importedIds: [KIT_STATE], dynamicallyImportedIds: [] },
		[KIT_STATE]: { importedIds: [], dynamicallyImportedIds: [] },
		[KIT_STORES]: { importedIds: [], dynamicallyImportedIds: [] }
	};
	const bundle = { graph: (id: string) => graph[id] ?? null, module_ids: () => Object.keys(graph) };
	const server_leg = () => ({ server: true, relocated: new Map<string, number>() });

	test('a hole reading the page through a $lib re-export looks up page.data', () => {
		const c = compiler_with({ aaaaaaaaaaaa: '/app/Hole.svelte' }, {});
		expect(value_of(c.relocate(PLACEHOLDER, server_leg(), bundle)!.code)).toEqual({
			aaaaaaaaaaaa: true
		});
	});

	test('a hole reading $app/stores, or importing $app/state on demand, looks up page.data', () => {
		const c = compiler_with(
			{ bbbbbbbbbbbb: '/app/Stores.svelte', cccccccccccc: '/app/Lazy.svelte' },
			{}
		);
		expect(value_of(c.relocate(PLACEHOLDER, server_leg(), bundle)!.code)).toEqual({
			bbbbbbbbbbbb: true,
			cccccccccccc: true
		});
	});

	test("Kit's page module importing its own halves is not a reader of the page", () => {
		const KIT_STATE_SERVER = '/app/node_modules/@sveltejs/kit/src/runtime/app/state/server.js';
		const kit_graph: Record<string, { importedIds: string[]; dynamicallyImportedIds: string[] }> = {
			...graph,
			[KIT_STATE]: { importedIds: [KIT_STATE_SERVER], dynamicallyImportedIds: [] },
			[KIT_STATE_SERVER]: { importedIds: [], dynamicallyImportedIds: [] }
		};
		const c = compiler_with(
			{ eeeeeeeeeeee: '/app/UrlOnly.svelte' },
			{ '/app/UrlOnly.svelte': new Set() }
		);
		const out = c.relocate(PLACEHOLDER, server_leg(), {
			graph: (id) => kit_graph[id] ?? null,
			module_ids: () => Object.keys(kit_graph)
		});
		expect(value_of(out!.code)).toEqual({ eeeeeeeeeeee: false });
	});

	test('a page reader whose keys were read (none of page.data) does not', () => {
		const c = compiler_with(
			{ dddddddddddd: '/app/UrlOnly.svelte' },
			{
				'/app/UrlOnly.svelte': new Set()
			}
		);
		expect(value_of(c.relocate(PLACEHOLDER, server_leg(), bundle)!.code)).toEqual({
			dddddddddddd: false
		});
	});
});
