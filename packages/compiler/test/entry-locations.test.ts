/**
 * ENTRY IDENTITY vs LOCATION, every layer. A hydrate island's entry and the runtime used to be
 * served under stable names from `immutable/` — a year-long cache on a file whose content changes
 * every build. Now: the IDENTITY stays the stable URL (every key: the `entry` attribute, the handoff's
 * maps, the fingerprint), the LOCATION is the content-hashed file the bundler named, and the stable
 * name is a shim of it. Layer by layer:
 *   build     — the driver emits by name, keeps refs, maps identity → location, writes the shims
 *   collector — every handoff map keyed by identity, the entry's own file never its own dependency
 *   handoff   — `entry_location` reads it at render time (the server bundle is built first)
 *   server    — the one runtime bootstrap, Region's `src`, preload hints, the graph's `s` map
 * (the browser's half: test/browser/entry-location*.test.ts; the real two-build proof:
 * internal/checks/cache-bust-check.ts)
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { location_map_files } from '../src/compiler/link/location-map.ts';
import {
	collectIslandDepModulepreloads,
	island_deps_module
} from '../src/compiler/link/island-deps.ts';
import {
	decode_island_graph,
	decode_island_locations,
	encode_island_graph
} from '../../core/src/island-graph.ts';
import { DocumentTail, island_graph_script } from '../../core/src/server/document-tail.ts';
import { entry_src, runtime_bootstrap } from '../../core/src/server/entry-location.ts';
import { plan_props_wire } from '../../core/src/server/props-wire.ts';
import { set_entry_locations, set_island_deps } from '../../core/test/_stubs/server.region-deps.ts';
import Region from '../../core/src/Region.svelte';
import Tiny from '../../core/test/_fixtures/Tiny.svelte';
import { Compiler, Program, CompileCtx, normalize_import_keys } from '../dist/compiler/index.js';
import { partial_ctx_init } from './_compile-ctx.ts';
import { dedent } from '@ogygia/core/contract';

const region = Region as unknown as Component<Record<string, unknown>>;
const GRAPH_RE = /<script type="application\/json" data-ogygia-graph>([^<]*)<\/script>/;

afterEach(() => {
	set_entry_locations({});
	set_island_deps({});
});

// ── the location maps ────────────────────────────────────────────────────────────────────────────
describe('the location maps: one map, named by its content and at the one fixed name', () => {
	const hash = (s: string) => String(s.length);
	const pairs = [
		['_app/ogygia/og-region.abc.js', '_app/immutable/og-region.abc.X1y2Z3a4.js']
	] as const;

	it('the content-hashed map: each identity → its hashed file, both relative to the map', () => {
		const [hashed] = location_map_files('_app', pairs, hash);
		expect(JSON.parse(hashed.source)).toEqual({
			'../ogygia/og-region.abc.js': './og-region.abc.X1y2Z3a4.js'
		});
		// named by its content: another build's map is another file (any host's immutable rule fits)
		expect(hashed.fileName).toBe(`_app/immutable/og-locations.${hash(hashed.source)}.json`);
	});

	it('the current build’s map: at the one fixed name, beside Kit’s version.json, outside immutable/', () => {
		const [, current] = location_map_files('_app', pairs, hash);
		expect(current.fileName).toBe('_app/ogygia.json');
		expect(JSON.parse(current.source)).toEqual({
			'./ogygia/og-region.abc.js': './immutable/og-region.abc.X1y2Z3a4.js'
		});
	});

	it('resolved against where it is served, both sides land where the build put them', () => {
		const served = 'https://cdn.test/docs/_app/ogygia.json';
		expect(new URL('./ogygia/og-region.abc.js', served).href).toBe(
			'https://cdn.test/docs/_app/ogygia/og-region.abc.js'
		);
		expect(new URL('./immutable/og-region.abc.X1y2Z3a4.js', served).href).toBe(
			'https://cdn.test/docs/_app/immutable/og-region.abc.X1y2Z3a4.js'
		);
	});

	it('nothing to map, no file', () => {
		expect(location_map_files('_app', [], hash)).toEqual([]);
	});

	it('the same pairs in another order write byte-identical maps under the same names (#490)', () => {
		const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
		const three = [
			['_app/ogygia/og-region.ccc.js', '_app/immutable/og-region.ccc.C3.js'],
			['_app/ogygia/og-region.aaa.js', '_app/immutable/og-region.aaa.A1.js'],
			['_app/ogygia/og-region.bbb.js', '_app/immutable/og-region.bbb.B2.js']
		] as const;
		expect(location_map_files('_app', [...three].reverse(), sha)).toEqual(
			location_map_files('_app', three, sha)
		);
	});
});

// ── the collector: every map keyed by identity ────────────────────────────────────────────────────
describe('the collector keys every map by IDENTITY, the location being a hashed file', () => {
	const ID_A = '/_app/immutable/og-region.aaaaaaaaaaaa.js';
	const ID_B = '/_app/immutable/og-region.bbbbbbbbbbbb.js';
	const RT_ID = '/_app/immutable/og-runtime.0123456789ab-feat.js';
	const bundle = {
		'_app/immutable/chunks/LocA.js': {
			type: 'chunk',
			fileName: '_app/immutable/chunks/LocA.js',
			imports: ['_app/immutable/chunks/Shared.js'],
			moduleIds: ['/app/A.svelte'],
			viteMetadata: { importedCss: ['_app/immutable/assets/A.css'] }
		},
		'_app/immutable/chunks/LocB.js': {
			type: 'chunk',
			fileName: '_app/immutable/chunks/LocB.js',
			imports: ['_app/immutable/chunks/Shared.js'],
			moduleIds: ['/app/B.svelte']
		},
		'_app/immutable/chunks/Shared.js': {
			type: 'chunk',
			fileName: '_app/immutable/chunks/Shared.js',
			imports: [],
			moduleIds: ['/node_modules/svelte/internal.js']
		},
		'_app/immutable/chunks/Rt.js': {
			type: 'chunk',
			fileName: '_app/immutable/chunks/Rt.js',
			imports: ['_app/immutable/chunks/Shared.js'],
			moduleIds: ['virtual:runtime']
		},
		// the shims are assets: never facades, never keys
		'_app/immutable/og-region.aaaaaaaaaaaa.js': {
			type: 'asset',
			fileName: '_app/immutable/og-region.aaaaaaaaaaaa.js'
		},
		'_app/immutable/og-runtime.0123456789ab-feat.js': {
			type: 'asset',
			fileName: '_app/immutable/og-runtime.0123456789ab-feat.js'
		}
	};
	const entries = {
		islands: new Map([
			['_app/immutable/chunks/LocA.js', ID_A],
			['_app/immutable/chunks/LocB.js', ID_B]
		]),
		runtime: RT_ID
	};
	const map = collectIslandDepModulepreloads(
		bundle as never,
		[],
		null,
		null,
		null,
		'_app/immutable/chunks/Rt.js',
		entries
	);

	it('js / css / page / remotes are keyed by the identity, never the hashed name', () => {
		expect(Object.keys(map.js).sort()).toEqual([ID_A, ID_B, RT_ID].sort());
		expect(map.js[ID_A]).toEqual(['/_app/immutable/chunks/Shared.js']);
		expect(map.css[ID_A]).toEqual(['/_app/immutable/assets/A.css']);
		expect(Object.keys(map.page).sort()).toEqual([ID_A, ID_B].sort());
		expect(Object.keys(map.remotes).sort()).toEqual([ID_A, ID_B].sort());
		expect(Object.keys(map.js).some((k) => k.includes('/chunks/Loc'))).toBe(false);
	});
	it("an entry's own file is never listed as its own dependency", () => {
		expect(map.js[ID_A]).not.toContain('/_app/immutable/chunks/LocA.js');
		expect(map.js[ID_B]).not.toContain('/_app/immutable/chunks/LocB.js');
	});
	it("the runtime's static imports ride under the runtime's identity", () => {
		expect(map.js[RT_ID]).toEqual(['/_app/immutable/chunks/Shared.js']);
	});
	it('without entries (a bundle from before hashing): a stable-named facade is its own identity, as before', () => {
		const legacy = collectIslandDepModulepreloads({
			'_app/immutable/og-region.cccccccccccc.js': {
				type: 'chunk',
				fileName: '_app/immutable/og-region.cccccccccccc.js',
				imports: ['_app/immutable/chunks/S.js']
			},
			'_app/immutable/chunks/S.js': {
				type: 'chunk',
				fileName: '_app/immutable/chunks/S.js',
				imports: []
			}
		} as never);
		expect(legacy.js['/_app/immutable/og-region.cccccccccccc.js']).toEqual([
			'/_app/immutable/chunks/S.js'
		]);
	});
	it('with entries given, a chunk that merely LOOKS like a stable name is not an entry', () => {
		const odd = collectIslandDepModulepreloads(
			{
				'_app/immutable/og-region.dddddddddddd.js': {
					type: 'chunk',
					fileName: '_app/immutable/og-region.dddddddddddd.js',
					imports: []
				}
			} as never,
			[],
			null,
			null,
			null,
			null,
			{ islands: new Map(), runtime: null }
		);
		expect(Object.keys(odd.js)).toEqual([]);
	});
});

// ── the handoff, read at render time ──────────────────────────────────────────────────────────────
describe('entry_location: the handoff read at render time', () => {
	const load_module = async (src: string) => {
		const file = path.join(
			os.tmpdir(),
			`og-entry-loc-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`
		);
		fs.writeFileSync(file, src);
		try {
			return await import(file);
		} finally {
			fs.rmSync(file, { force: true });
		}
	};
	const with_handoff = (json: unknown) =>
		island_deps_module(true, false).replace(
			"'__OGYGIA_ISLAND_DEPS_INLINE__'",
			JSON.stringify(JSON.stringify(json))
		);

	it('an identity the build mapped → its location', async () => {
		const m = await load_module(
			with_handoff({
				entries: { '/_app/immutable/og-region.aaaaaaaaaaaa.js': '/_app/immutable/chunks/LocA.js' }
			})
		);
		expect(m.entry_location('/_app/immutable/og-region.aaaaaaaaaaaa.js')).toBe(
			'/_app/immutable/chunks/LocA.js'
		);
		expect(m.entry_location('/_app/immutable/og-region.ffffffffffff.js')).toBeNull();
		expect(m.entry_location('')).toBeNull();
	});
	it('a handoff from before hashing (no entries), or a malformed one → null (the identity is served)', async () => {
		expect((await load_module(with_handoff({ js: {} }))).entry_location('/x.js')).toBeNull();
		expect(
			(await load_module(with_handoff({ entries: 'nope' }))).entry_location('/x.js')
		).toBeNull();
		expect(
			(await load_module(with_handoff({ entries: { '/x.js': 42 } }))).entry_location('/x.js')
		).toBeNull();
	});
	it('the client leg knows no location; in dev the identity is the location', async () => {
		expect(
			(await load_module(island_deps_module(false, false))).entry_location('/x.js')
		).toBeNull();
		const dev = await load_module(island_deps_module(true, true));
		expect(dev.entry_location('/x.js')).toBe('/x.js');
		expect(dev.entry_location('')).toBeNull();
	});
});

// ── the island graph's `s` map ────────────────────────────────────────────────────────────────────
describe("the island graph's `s`: locations of entries no element carries", () => {
	it('round-trips beside the graph, which is unchanged', () => {
		const graph = new Map([['/a.js', ['/svelte.js']]]);
		const locations = new Map([['/snip.js', '/chunks/Snip.js']]);
		const text = encode_island_graph(graph, locations);
		expect(decode_island_graph(text)).toEqual(graph);
		expect(decode_island_locations(text)).toEqual(locations);
	});
	it('no locations → no `s` key (byte-identical to the format before)', () => {
		const graph = new Map([['/a.js', ['/svelte.js']]]);
		expect(encode_island_graph(graph, new Map())).toBe(encode_island_graph(graph));
		expect(JSON.parse(encode_island_graph(graph))).not.toHaveProperty('s');
	});
	it('malformed `s` entries are dropped, the rest kept; garbage decodes to nothing', () => {
		expect(
			decode_island_locations('{"h":[],"e":{},"s":{"/a.js":"/A.js","/b.js":7,"/c.js":null}}')
		).toEqual(new Map([['/a.js', '/A.js']]));
		expect(decode_island_locations('not json')).toEqual(new Map());
		expect(decode_island_locations('{"h":[],"e":{},"s":"x"}')).toEqual(new Map());
	});
	it('a graph script is written for locations alone (a page whose only entry is a snippet)', () => {
		const html = island_graph_script(new Map(), new Map([['/snip.js', '/chunks/Snip.js']]));
		expect(decode_island_locations(GRAPH_RE.exec(html)![1])).toEqual(
			new Map([['/snip.js', '/chunks/Snip.js']])
		);
		expect(island_graph_script(new Map(), null)).toBe('');
	});
});

// ── the document tail ─────────────────────────────────────────────────────────────────────────────
describe('the document tail', () => {
	it('carries the locations it was told (first wins), and is not empty for them alone', () => {
		const tail = new DocumentTail();
		expect(tail.empty).toBe(true);
		tail.locate('/snip.js', '/chunks/Snip.js');
		tail.locate('/snip.js', '/chunks/Other.js');
		expect(tail.empty).toBe(false);
		expect(decode_island_locations(GRAPH_RE.exec(tail.render())![1]).get('/snip.js')).toBe(
			'/chunks/Snip.js'
		);
	});
	it("an island's recorded JS closure leads with its location — the file the profiler weighs", () => {
		const tail = new DocumentTail();
		tail.props('fp1', plan_props_wire({}, '/id.js'), {
			entry: '/id.js',
			name: 'T',
			module_url: '/chunks/Loc.js',
			wake: 'load',
			interactivity: null
		});
		tail.graph('/id.js', ['/chunks/Dep.js'], 'fp1', '/chunks/Loc.js');
		const rows = (tail.render(null, true), tail.island_rows())!;
		expect(rows[0].hints).toEqual(['/chunks/Loc.js', '/chunks/Dep.js']);
		// …the graph itself stays keyed by the identity
		expect([...decode_island_graph(GRAPH_RE.exec(tail.render())![1]).keys()]).toEqual(['/id.js']);
	});
});

// ── the server: the one runtime bootstrap ─────────────────────────────────────────────────────────
describe('the runtime bootstrap (server/entry-location.ts), shared by every document path', () => {
	it('loads the location, with the runtime identity’s static imports preloaded', () => {
		set_entry_locations({ '/og-runtime.js': '/chunks/Rt.js' });
		set_island_deps({ '/og-runtime.js': ['/chunks/Shared.js'] });
		const html = runtime_bootstrap();
		expect(html).toContain(
			`<script type="module" data-ogygia-runtime src="/chunks/Rt.js" onerror="console.error('[ogygia] https://ogygiajs.dev/e/runtime_load_failed')">\x3C/script>`
		);
		expect(html).toContain(
			'<link rel="modulepreload" href="/chunks/Shared.js" data-ogygia-runtime-dep>'
		);
		expect(html).not.toContain('/og-runtime.js');
	});
	it('no location (dev, a handoff from before hashing): the identity itself', () => {
		expect(runtime_bootstrap()).toContain('src="/og-runtime.js"');
		expect(entry_src('/x/og-region.aaaaaaaaaaaa.js')).toBe('/x/og-region.aaaaaaaaaaaa.js');
		expect(entry_src('')).toBe('');
	});
	it('the base / assets prefix applies to the location and every preload', () => {
		set_entry_locations({ '/og-runtime.js': '/chunks/Rt.js' });
		set_island_deps({ '/og-runtime.js': ['/chunks/Shared.js'] });
		const html = runtime_bootstrap((u) => `https://cdn.test${u}`);
		expect(html).toContain('src="https://cdn.test/chunks/Rt.js"');
		expect(html).toContain('href="https://cdn.test/chunks/Shared.js"');
	});
});

// ── Region: identity and location on the element ──────────────────────────────────────────────────
describe('Region writes the identity as `entry` and the location as `src`', () => {
	const ENTRY = '/islands/tiny.js';
	const render_island = () => {
		const out = render(region, {
			props: { __mode: 'island', __entry: ENTRY, __component: Tiny, __props: {} }
		});
		return out.head + out.body;
	};
	const attr = (html: string, name: string) =>
		new RegExp(`<ogygia-region[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];

	it('a mapped island: `entry` stays its identity, `src` is its location', () => {
		set_entry_locations({ [ENTRY]: '/chunks/Tiny.Hh12.js' });
		const html = render_island();
		expect(attr(html, 'entry')).toBe(ENTRY);
		expect(attr(html, 'src')).toBe('/chunks/Tiny.Hh12.js');
	});
	it('an unmapped island (dev, old handoff): no `src` at all — the runtime loads the identity', () => {
		expect(attr(render_island(), 'src')).toBeUndefined();
	});
	it('the fingerprint is the identity’s: a new location (a new build) never changes it', () => {
		const fp = (html: string) => attr(html, 'data-og-fp');
		const before = fp(render_island());
		set_entry_locations({ [ENTRY]: '/chunks/Tiny.Zz99.js' });
		expect(fp(render_island())).toBe(before);
	});
	it('no location in the handoff: no `src` (the browser finds it in the build’s location map)', () => {
		set_entry_locations({});
		expect(attr(render_island(), 'src')).toBeUndefined();
	});
});

// ── the router's next-page warm reads both off the fetched HTML ───────────────────────────────────
describe("the router's warm scan: identity and location off an open tag", () => {
	it('reads each attribute exactly, never a longer name that ends the same', async () => {
		const { tags } = await import('../../core/src/wire-markup.ts');
		const attrs = (open: string) => [...tags(open, 'ogygia-region')][0]?.attrs;
		const found = attrs(
			'<ogygia-region entry="./_app/immutable/og-region.aaaaaaaaaaaa.js" data-src="./nope.js" src="./_app/immutable/chunks/Loc.js" wake="load">'
		);
		expect(found?.get('entry')).toBe('./_app/immutable/og-region.aaaaaaaaaaaa.js');
		expect(found?.get('src')).toBe('./_app/immutable/chunks/Loc.js');
		expect(attrs('<ogygia-region entry="/a.js" data-src="/b.js">')?.get('src')).toBeUndefined();
		expect(attrs('<ogygia-region entry="/a.js">')?.get('src')).toBeUndefined();
		expect(attrs('<ogygia-region src="/unterminated>')).toBeUndefined();
	});
});

// ── the driver: emit by name, map, shim ───────────────────────────────────────────────────────────
describe('the driver: entries emitted by name, mapped, and shimmed', () => {
	let root = '';
	beforeAll(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-entry-emit-'));
		const files: Record<string, string> = {
			'src/routes/+layout.ts': 'export const csr = false;\n',
			'src/routes/+page.svelte': `${dedent`
				<script>
					import Widget from '$lib/Widget.svelte' with { wake: 'visible' };
					import Chart from '$lib/Chart.svelte' with { wake: 'idle' };
				</script>
				<Widget /><Chart />
			`}\n`,
			'src/lib/Widget.svelte': `<p>w</p>\n`,
			'src/lib/Chart.svelte': `<p>c</p>\n`
		};
		for (const [rel, src] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			fs.writeFileSync(path.join(root, rel), src);
		}
	});
	afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

	const make = () => {
		const program = new Program({ forms: true, router: true });
		const compiler = new Compiler(
			program,
			{
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
				outHash: new Map()
			},
			new CompileCtx(
				partial_ctx_init({
					root,
					base: '/',
					app_dir: '_app',
					runtime_hash: '0123456789ab',
					libDir: path.join(root, 'src/lib'),
					is_dev: false,
					id_salt: '',
					visibleMargin: '0px',
					presets: {},
					import_keys: normalize_import_keys(undefined),
					resolve_alias: [],
					is_build: true,
					pkg_root: '/nowhere/ogygia',
					app_shims: {
						'$app/state': '/x/a.js',
						'$app/stores': '/x/b.js',
						'$app/navigation': '/x/c.js'
					}
				})
			)
		);
		compiler.start_leg('client', false);
		compiler.prescan();
		return compiler;
	};
	/** The client leg `make` started. */
	const client = (compiler: Compiler) => compiler.leg({ name: 'client', server: false });
	const fake_emit = () => {
		const emitted: { id: string; name?: string; fileName?: string }[] = [];
		return {
			emitted,
			emit: (c: { id: string; name?: string; fileName?: string }) => (
				emitted.push(c),
				`ref${emitted.length}`
			)
		};
	};

	it('every island and the runtime are emitted by NAME (hashed by the bundler), never a fixed file name', () => {
		const compiler = make();
		const { emitted, emit } = fake_emit();
		compiler.emit_build_chunks(client(compiler), emit, { emitRuntime: true });
		expect(emitted.length).toBe(3);
		expect(emitted.every((c) => c.name && !c.fileName)).toBe(true);
		expect(emitted.filter((c) => c.name!.startsWith('og-region.')).length).toBe(2);
		expect(emitted.some((c) => c.name === 'og-runtime' || c.name!.startsWith('og-runtime-'))).toBe(
			true
		);
	});
	it('our entries get a readable, content-hashed file name; every other chunk keeps the app’s naming', () => {
		const compiler = make();
		expect(compiler.entry_file_pattern('og-region.0123456789ab')).toBe(
			'_app/immutable/[name].[hash].js'
		);
		expect(compiler.entry_file_pattern('og-runtime')).toBe('_app/immutable/[name].[hash].js');
		expect(compiler.entry_file_pattern('og-runtime-4b029c13h')).toBe(
			'_app/immutable/[name].[hash].js'
		);
		for (const other of ['index', 'og-regionx', 'og-runtimeish', 'chunk', '', undefined])
			expect(compiler.entry_file_pattern(other)).toBeNull();
	});
	it('the runtime’s file names its features, like its stable name does', () => {
		const compiler = make();
		const { emitted, emit } = fake_emit();
		compiler.emit_build_chunks(client(compiler), emit, { emitRuntime: true });
		const runtime = emitted.find((c) => c.name!.startsWith('og-runtime'))!;
		const stable = compiler.runtime_chunk_filename();
		// the stable name: `…/og-runtime.<hash>[-<features>].js`
		const tail = stable.slice(
			stable.lastIndexOf('/og-runtime.') + '/og-runtime.'.length,
			-'.js'.length
		);
		const feat = tail.includes('-') ? tail.slice(tail.indexOf('-') + 1) : '';
		expect(runtime.name).toBe(feat ? `og-runtime-${feat}` : 'og-runtime');
	});
	it('identity → location for each, from the bundler’s final names', () => {
		const compiler = make();
		const { emit } = fake_emit();
		compiler.emit_build_chunks(client(compiler), emit, { emitRuntime: true });
		const names: Record<string, string> = {
			ref1: '_app/immutable/chunks/Rt.js',
			ref2: '_app/immutable/chunks/W.js',
			ref3: '_app/immutable/chunks/C.js'
		};
		const e = compiler.entry_locations(client(compiler), (ref: string) => names[ref]);
		expect(Object.keys(e.locations).length).toBe(3);
		for (const [identity, location] of Object.entries(e.locations)) {
			expect(identity).toMatch(/^\/_app\/ogygia\/og-(region\.[0-9a-f]{12}|runtime\.[\w-]+)\.js$/);
			expect(location).toMatch(/^\/_app\/immutable\/chunks\/\w+\.js$/);
		}
		expect(e.runtime_file).toBe('_app/immutable/chunks/Rt.js');
		expect(e.locations[e.runtime!]).toBe('/_app/immutable/chunks/Rt.js');
		expect([...e.islands.keys()].sort()).toEqual([
			'_app/immutable/chunks/C.js',
			'_app/immutable/chunks/W.js'
		]);
	});
	it('two builds that emit the islands in another order write the same maps and handoff entries (#490)', () => {
		const built = (reverse: boolean) => {
			const compiler = make();
			const leg = client(compiler);
			const { emit } = fake_emit();
			compiler.emit_build_chunks(leg, emit, { emitRuntime: true });
			// the bundler's transform order is not stable from build to build
			if (reverse) {
				const refs = [...leg.island_entry_refs].reverse();
				leg.island_entry_refs.clear();
				for (const [rid, ref] of refs) leg.island_entry_refs.set(rid, ref);
			}
			const name = (ref: string) => `_app/immutable/chunks/${ref}.js`;
			return {
				maps: compiler.location_maps(leg, name),
				entries: JSON.stringify(compiler.entry_locations(leg, name).locations)
			};
		};
		expect(built(true)).toEqual(built(false));
	});
	it('the location maps name every island entry; the handoff learns the hashed one’s path; no other file', () => {
		const compiler = make();
		const leg = client(compiler);
		const { emit } = fake_emit();
		compiler.emit_build_chunks(leg, emit, { emitRuntime: true });
		const files = compiler.location_maps(leg, (ref: string) => `_app/immutable/chunks/${ref}.js`);
		// the two maps, and only them: an identity is a name, never a file of its own
		expect(files.map((f) => f.fileName.replace(/[0-9a-f]{12}/, 'H'))).toEqual([
			'_app/immutable/og-locations.H.json',
			'_app/ogygia.json'
		]);
		expect(leg.location_map_url).toBe(`/${files[0].fileName}`);
		const pairs = Object.entries(JSON.parse(files[0].source) as Record<string, string>);
		expect(pairs).toHaveLength(2); // the two islands (the runtime loads by its script's own src)
		for (const [identity, hashed] of pairs) {
			expect(identity).toMatch(/^\.\.\/ogygia\/og-region\.[0-9a-f]{12}\.js$/);
			expect(hashed).toMatch(/^\.\/chunks\/ref\d\.js$/);
		}
	});
	it('a second build in one process (watch) emits every island again and maps them all', () => {
		const compiler = make();
		const first = client(compiler);
		compiler.emit_build_chunks(first, fake_emit().emit, { emitRuntime: true });
		compiler.location_maps(first, (ref: string) => `_app/immutable/chunks/${ref}.js`);
		compiler.start_leg('client', false);
		compiler.prescan();
		const leg = client(compiler);
		expect(leg).not.toBe(first);
		const again = fake_emit();
		compiler.emit_build_chunks(leg, again.emit, { emitRuntime: true });
		expect(again.emitted.filter((c) => c.name!.startsWith('og-region.')).length).toBe(2);
		const files = compiler.location_maps(leg, (ref: string) => `_app/immutable/chunks/${ref}.js`);
		expect(Object.keys(JSON.parse(files[0].source) as object)).toHaveLength(2);
	});
	it('no runtime emitted → no runtime location; a second emit starts clean', () => {
		const compiler = make();
		const first = fake_emit();
		compiler.emit_build_chunks(client(compiler), first.emit, { emitRuntime: true });
		const program_reset = make();
		const { emitted, emit } = fake_emit();
		program_reset.emit_build_chunks(client(program_reset), emit, { emitRuntime: false });
		expect(emitted.length).toBe(2);
		const e = program_reset.entry_locations(client(program_reset), (ref: string) => `x/${ref}.js`);
		expect(e.runtime).toBeNull();
		expect(Object.keys(e.locations).some((k) => k.includes('og-runtime'))).toBe(false);
	});
});
