// Kit's route tree, as ogygia reads it: which files are pages and layouts (`+page@.svelte` and
// `+layout@x.svelte` included), which layouts a page uses (a `@` reset skips the ones between),
// and each node's `csr`. Pinned by cases, then by a differential against Kit's own
// `create_manifest_data` over generated route trees (seeded 2; OGYGIA_FUZZ_SEED, OGYGIA_FUZZ_RUNS).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fc } from '@ogygia/config/sim';
import {
	clientBuildWillSkip,
	csrTrueRouteIds,
	errorCsrTrueRouteIds,
	hasAnyCsrFalseRoute,
	is_route_component,
	page_route_config,
	route_reader,
	routeCsrIsFalse,
	routeCsrIsTrue
} from '../src/compiler/kit.ts';
import { node_fs } from '../src/compiler/fs.ts';

let R = route_reader(node_fs);

const made: string[] = [];
afterAll(() => {
	for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** Write a route tree under `<tmp>/src/routes`; returns the routes dir. */
function tree(files: Record<string, string>): string {
	const root = mkdtempSync(path.join(tmpdir(), 'og-route-tree-'));
	made.push(root);
	const routes = path.join(root, 'src', 'routes');
	mkdirSync(routes, { recursive: true });
	mkdirSync(path.join(root, 'static'));
	for (const [rel, src] of Object.entries(files)) {
		const abs = path.join(routes, rel);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, src);
	}
	R = route_reader({ ...node_fs }); // a fresh set of answers per tree
	return routes;
}
const OFF = 'export const csr = false;\n';
const ON = 'export const csr = true;\n';

describe('a route file with a layout reset is a route component', () => {
	it.each([
		['+page@.svelte', 'page'],
		['+page@a.svelte', 'page'],
		['+page@(group).svelte', 'page'],
		['+layout@.svelte', 'layout'],
		['+layout@(app).md', 'layout']
	] as const)('%s is a %s', (name, kind) => {
		expect(is_route_component(name, kind)).toBe(true);
	});
	it.each(['+page.ts', '+page.server.ts', '+pages.svelte', '+page@.ts', '+layout.svelte'])(
		'%s is not a page component',
		(name) => {
			expect(is_route_component(name, 'page')).toBe(false);
		}
	);
});

describe('a dev edit to a route file changes the route answers', () => {
	it.each(['+page.svelte', '+page@.svelte', '+page.md'])('a new %s is a new route', (name) => {
		const routes = tree({ 'a/+page.svelte': '<h1>a</h1>' });
		expect(csrTrueRouteIds(R, routes)).toEqual(['/a']);
		const abs = path.join(routes, 'b', name);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, '<h1>b</h1>');
		expect(R.touch(abs, 'create')).toBe(true);
		expect(csrTrueRouteIds(R, routes).sort()).toEqual(['/a', '/b']);
	});
});

describe('a page with a layout reset', () => {
	it('a csr = true `+page@.svelte` is a csr=true route', () => {
		const routes = tree({
			'+layout.ts': OFF,
			'+page.svelte': '<h1>home</h1>',
			'a/+page@.svelte': '<h1>a</h1>',
			'a/+page.ts': ON,
			'b/+page.svelte': '<h1>b</h1>',
			'b/+page.ts': ON
		});
		expect(csrTrueRouteIds(R, routes).sort()).toEqual(['/a', '/b']);
		expect(routeCsrIsTrue(R, path.join(routes, 'a/+page@.svelte'), routes)).toBe(true);
	});

	it('a csr = false `+page@.svelte` is a csr=false route', () => {
		const routes = tree({ 'a/+page@.svelte': '<h1>a</h1>', 'a/+page.ts': OFF });
		expect(hasAnyCsrFalseRoute(R, routes)).toBe(true);
		expect(routeCsrIsFalse(R, path.join(routes, 'a/+page@.svelte'), routes)).toBe(true);
	});

	it('skips the options of the layouts between it and the reset target', () => {
		const routes = tree({
			'a/+layout.svelte': '<slot />',
			'a/+layout.ts': OFF,
			'a/+page.svelte': '<h1>a</h1>',
			'a/b/+page@.svelte': '<h1>b</h1>'
		});
		expect(csrTrueRouteIds(R, routes)).toEqual(['/a/b']);
		// the error page of /a/b renders with the root layout alone
		expect(errorCsrTrueRouteIds(R, routes).sort()).toEqual(['/a/b']);
		// the layout at a/ serves /a only, which is csr=false: its islands stay
		expect(routeCsrIsFalse(R, path.join(routes, 'a/+layout.svelte'), routes)).toBe(true);
	});

	it('resets to a named ancestor segment, groups included', () => {
		const routes = tree({
			'(app)/+layout.ts': OFF,
			'(app)/x/+layout.ts': ON,
			'(app)/x/y/+page@(app).svelte': '<h1>y</h1>'
		});
		expect(routeCsrIsFalse(R, path.join(routes, '(app)/x/y/+page@(app).svelte'), routes)).toBe(
			true
		);
	});

	it('takes route config from the layouts it uses only', () => {
		const routes = tree({
			'a/+layout.ts': 'export const config = { postrender: false };',
			'a/+page.svelte': '<h1>a</h1>',
			'a/b/+page@.svelte': '<h1>b</h1>'
		});
		const config = page_route_config(R, routes, ['postrender']);
		expect(config['/a']).toEqual({ postrender: false });
		expect(config['/a/b']).toEqual({});
	});
});

describe('a layout with a layout reset', () => {
	it('skips the options of the layouts between it and the reset target', () => {
		const routes = tree({
			'a/+layout.ts': OFF,
			'a/b/+layout@.svelte': '<slot />',
			'a/b/+page.svelte': '<h1>b</h1>'
		});
		expect(csrTrueRouteIds(R, routes)).toEqual(['/a/b']);
		expect(routeCsrIsTrue(R, path.join(routes, 'a/b/+layout@.svelte'), routes)).toBe(true);
	});
});

// ── the differential: Kit's own route tree ──────────────────────────────────────────────────

const kit_manifest = await import(
	/* @vite-ignore */ new URL(
		'../core/sync/create_manifest_data/index.js',
		import.meta.resolve('@sveltejs/kit')
	).href
).catch(() => null);

// Kit's run-time merge of the page options and `config` of a page's nodes
const kit_page_nodes = await import(
	/* @vite-ignore */ new URL('../utils/page_nodes.js', import.meta.resolve('@sveltejs/kit')).href
).catch(() => null);
const POSTRENDER_RE = /config = \{ postrender: (true|false) \}/;

type KitNode = {
	component?: string;
	universal?: string;
	server?: string;
	page_options: { csr?: unknown } | null;
};
type KitRoute = {
	id: string;
	leaf: KitNode | null;
	page: { layouts: Array<number | undefined> } | null;
};

function kit_tree(routes: string): { nodes: KitNode[]; routes: KitRoute[] } {
	const root = path.dirname(path.dirname(routes));
	const config = {
		extensions: ['.svelte'],
		kit: {
			moduleExtensions: ['.js', '.ts'],
			router: { type: 'pathname' },
			files: {
				routes,
				assets: path.join(root, 'static'),
				params: path.join(root, 'src/params'),
				hooks: {
					server: path.join(root, 'src/hooks.server'),
					client: path.join(root, 'src/hooks.client'),
					universal: path.join(root, 'src/hooks')
				}
			}
		}
	};
	return kit_manifest!.default({ config, cwd: root });
}

// every page path distinct (Kit refuses two pages on one path); a group dir holds layouts only
const DIRS = ['', 'a', 'a/b', '(g)', '(g)/c', 'a/(h)', 'a/(h)/d', '(g)/c/e'];
const is_group = (d: string) => d.endsWith(')');
/** The segments a reset written in `dir` may name: its own and its ancestors', the root's ''. */
const reset_targets = (d: string) => ['', ...(d ? d.split('/') : [])];
const option = fc.constantFrom(undefined, ON, OFF);
const config_option = fc.constantFrom(undefined, undefined, true, false);
const component = (kind: 'page' | 'layout', d: string) =>
	fc.oneof(
		{ weight: 3, arbitrary: fc.constant(undefined) },
		{ weight: 3, arbitrary: fc.constant(`+${kind}.svelte`) },
		{
			weight: 2,
			arbitrary: fc.constantFrom(...reset_targets(d).map((r) => `+${kind}@${r}.svelte`))
		}
	);
const level = (d: string) =>
	fc.record({
		page: is_group(d) ? fc.constant(undefined) : component('page', d),
		layout: component('layout', d),
		page_universal: is_group(d) ? fc.constant(undefined) : option,
		page_server: is_group(d) ? fc.constant(undefined) : option,
		layout_universal: option,
		layout_server: option,
		// a claimed `config` key per module: postrender's
		page_universal_config: is_group(d) ? fc.constant(undefined) : config_option,
		page_server_config: is_group(d) ? fc.constant(undefined) : config_option,
		layout_universal_config: config_option,
		layout_server_config: config_option,
		error: fc.boolean()
	});
const levels_arb = fc.tuple(...DIRS.map(level));
type Level = ReturnType<typeof level> extends fc.Arbitrary<infer T> ? T : never;

function files_of(levels: Level[]): Record<string, string> {
	const files: Record<string, string> = {};
	levels.forEach((l, i) => {
		const d = DIRS[i];
		const at = (name: string) => (d ? `${d}/${name}` : name);
		const module = (name: string, csr: string | undefined, postrender: boolean | undefined) => {
			const config =
				postrender === undefined ? '' : `export const config = { postrender: ${postrender} };\n`;
			if (csr || config) files[at(name)] = (csr ?? '') + config;
		};
		if (l.page) files[at(l.page)] = '<h1>p</h1>';
		if (l.layout) files[at(l.layout)] = '<slot />';
		module('+page.ts', l.page_universal, l.page_universal_config);
		module('+page.server.ts', l.page_server, l.page_server_config);
		module('+layout.ts', l.layout_universal, l.layout_universal_config);
		module('+layout.server.ts', l.layout_server, l.layout_server_config);
		if (l.error) files[at('+error.svelte')] = '<h1>e</h1>';
	});
	return files;
}

describe.skipIf(!kit_manifest)('the route tree against Kit’s, over generated route trees', () => {
	let compared = 0;
	afterAll(() => expect(compared).toBeGreaterThan(50));
	it('every page’s csr, its error page’s csr and the client-build skip agree with Kit', () => {
		fc.assert(
			fc.property(levels_arb, (levels) => {
				const files = files_of(levels);
				fc.pre(Object.keys(files).length > 0);
				const routes = tree(files);
				let kit: ReturnType<typeof kit_tree>;
				try {
					kit = kit_tree(routes);
				} catch (e) {
					// Kit refuses the tree: a reset to a missing segment, or two pages on one path
					if (!/missing segment|conflict with each other/.test(String(e))) throw e;
					return;
				}
				// Kit's static reader gives up on a module whose `config` is an object: no answer to compare
				if (kit.nodes.some((n) => n.page_options === null)) return;
				compared++;
				const root = path.dirname(path.dirname(routes));
				const csr_of = (options: KitNode['page_options']) => options?.csr;
				const want_true: string[] = [];
				const want_error_true: string[] = [];
				for (const route of kit.routes) {
					if (!route.page || !route.leaf?.component) continue;
					const id = route.id
						.split('/')
						.filter((s) => s && !s.startsWith('('))
						.join('/');
					const leaf_csr = csr_of(route.leaf.page_options);
					if (leaf_csr !== false) want_true.push(`/${id}`);
					const host = path.join(root, route.leaf.component);
					expect(
						routeCsrIsFalse(R, host, routes),
						`${route.leaf.component}\n${JSON.stringify(files)}`
					).toBe(leaf_csr === false);
					const layouts = route.page.layouts.filter((i): i is number => i !== undefined);
					const deepest = layouts.length ? kit.nodes[layouts[layouts.length - 1]] : null;
					if (csr_of(deepest?.page_options ?? null) !== false) want_error_true.push(`/${id}`);
				}
				const files_json = JSON.stringify(files);
				expect(csrTrueRouteIds(R, routes).sort(), files_json).toEqual(
					[...new Set(want_true)].sort()
				);
				expect(errorCsrTrueRouteIds(R, routes).sort(), files_json).toEqual(
					[...new Set(want_error_true)].sort()
				);
				expect(clientBuildWillSkip(R, routes), files_json).toBe(
					kit.nodes.every((n) => csr_of(n.page_options) === false)
				);
			}),
			{
				seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 2),
				numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 200)
			}
		);
	});

	it.skipIf(!kit_page_nodes)(
		'every page’s merged route config agrees with Kit’s get_config',
		() => {
			fc.assert(
				fc.property(levels_arb, (levels) => {
					const files = files_of(levels);
					fc.pre(Object.keys(files).length > 0);
					const routes = tree(files);
					let kit: ReturnType<typeof kit_tree>;
					try {
						kit = kit_tree(routes);
					} catch (e) {
						if (!/missing segment|conflict with each other/.test(String(e))) throw e;
						return;
					}
					compared++;
					const routes_rel = path.relative(path.dirname(path.dirname(routes)), routes);
					// the module's value at run time, as Kit loads it: its `config` export
					const loaded = (file: string | undefined) => {
						if (!file) return undefined;
						const m = POSTRENDER_RE.exec(files[path.relative(routes_rel, file)] ?? '');
						return { config: m ? { postrender: m[1] === 'true' } : undefined };
					};
					const ours = page_route_config(R, routes, ['postrender']);
					for (const route of kit.routes) {
						if (!route.page || !route.leaf) continue;
						const nodes = [
							...route.page.layouts.map((i) => (i === undefined ? undefined : kit.nodes[i])),
							route.leaf
						].map((n) => n && { universal: loaded(n.universal), server: loaded(n.server) });
						const want = new kit_page_nodes!.PageNodes(nodes).get_config() ?? {};
						const id = `/${route.id
							.split('/')
							.filter((s) => s && !s.startsWith('('))
							.join('/')}`;
						expect(ours[id], `${id}\n${JSON.stringify(files)}`).toEqual(want);
					}
				}),
				{
					seed: Number(process.env.OGYGIA_FUZZ_SEED ?? 2),
					numRuns: Number(process.env.OGYGIA_FUZZ_RUNS ?? 200)
				}
			);
		}
	);
});
