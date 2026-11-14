import { dedent } from '@ogygia/core/contract';
import path from 'node:path';
import {
	collectFoucCssReachable,
	scoped_component_css,
	type PreprocessCss,
	type WalkResolve
} from '../fouc-css.ts';
import { resolve_app_spec, type AppSpecCtx } from '../app-spec.ts';
import type { ExportIndex } from '../exports/index.ts';

const PATH_SEP = /[/\\]/;
const SVELTE_RE = /\.svelte$/;
const BARREL_RE = /\.(?:ts|js|mjs)$/;
const CSS_EXT_RE = /\.css$/;
const RESOLVE_SUFFIXES = ['', '.ts', '.js', '.mjs', '.svelte', '/index.ts', '/index.js'];

export const ROUTER_CSS_KEY_PREFIX = 'rcss:';

const posix = (p: string) => p.split(PATH_SEP).join('/');

/** The handoff css-map key for one root component (posix-rel to the app root). */
export function router_css_key(root: string, abs: string): string {
	return ROUTER_CSS_KEY_PREFIX + posix(path.relative(root, abs));
}

/**
 * The `.svelte` ROOTS of the app's router modules: BFS from every page module (`b.pageModules()`),
 * through the app's own `.ts`/`.js` re-exports (barrels — resolved as build DATA by the app spec
 * rule, imports untouched), collecting `.svelte` leaves. `module_specs` is the prescan's import-spec
 * record (module abs path → its import/export-from specifiers). Sorted for determinism across legs.
 */
export function router_css_roots(
	router_modules: ReadonlySet<string>,
	module_specs: ReadonlyMap<string, readonly string[]>,
	spec_ctx: AppSpecCtx,
	exists: (p: string) => boolean
): string[] {
	const roots = new Set<string>();
	const visited = new Set<string>();

	const resolve_spec = (spec: string, importer: string): string | null => {
		const base = resolve_app_spec(spec.split('?')[0], importer, spec_ctx);
		if (!base) return null;
		for (const suffix of RESOLVE_SUFFIXES) {
			const candidate = path.normalize(base + suffix);
			if (exists(candidate)) return candidate;
		}
		return null;
	};

	const visit = (mod: string) => {
		if (visited.has(mod)) return;
		visited.add(mod);
		for (const spec of module_specs.get(mod) ?? []) {
			const resolved = resolve_spec(spec, mod);
			if (!resolved) continue;
			if (SVELTE_RE.test(resolved)) roots.add(resolved);
			else if (BARREL_RE.test(resolved)) visit(resolved);
		}
	};

	for (const mod of router_modules) visit(mod);
	return [...roots].sort();
}

/**
 * Emit the `ogygia:server/router-css` source. Empty (`export {}`) when the app has no router
 * modules — the router's dynamic import of this virtual then registers nothing, zero cost.
 *
 * Router routes are values rendered through `document()`, not Kit routes, so Kit never links their
 * CSS. Each root (`router_css_roots`) is registered with a thunk for its stylesheet entries, and
 * the router hands the components it renders to `componentCssHead()`, which claims them deduped
 * with held-region links. Prod: each root is imported by absolute path (the module instance the
 * router holds) and links the base plus its handoff hrefs. Dev: the compiled CSS is inlined as
 * `path → entries` data with no component import, keyed by both the root-relative and the
 * absolute path (svelte's dev filename metadata carries either), so Kit's dev style collector
 * cannot crawl router trees into other pages.
 */
export async function router_css_module(
	roots: readonly string[],
	opts: {
		root: string;
		lib_dir: string;
		is_dev: boolean;
		read_file: (p: string) => string | null;
		/** the plugin's CSS preprocessor: dev compiles a component as the build does */
		preprocess?: PreprocessCss;
		/** the bundler's resolver, for the dev tree-CSS walk (compiler/fouc-css.ts) */
		resolve?: (spec: string, importer: string) => Promise<string | null>;
		/** `resolve`'s export index */
		exports?: ExportIndex<WalkResolve>;
	}
): Promise<string> {
	if (roots.length === 0) return 'export {};\n';

	const lines: string[] = [`import { register_router_css } from 'ogygia/internal/register';`];

	if (opts.is_dev) {
		const assignments: string[] = [];
		for (const abs of roots) {
			const entries: Array<{ key: string; css: string }> = [];
			for (const e of await collectFoucCssReachable(abs, {
				resolve: opts.resolve,
				exports: opts.exports,
				root: opts.root,
				libDir: opts.lib_dir,
				readFile: opts.read_file
			})) {
				const e_rel = posix(path.relative(opts.root, e.abs));
				if (e.kind === 'scoped') {
					const source = opts.read_file(e.abs);
					if (source == null) continue;
					const css = await scoped_component_css(e.abs, source, opts.preprocess);
					if (css) entries.push({ key: `rcss-dev:${e_rel}`, css });
				} else {
					if (!CSS_EXT_RE.test(e.abs)) continue;
					const css = opts.read_file(e.abs);
					if (css) entries.push({ key: `rcss-dev:${e_rel}`, css });
				}
			}
			if (!entries.length) continue;
			const abs_key = JSON.stringify(posix(abs));
			const rel = posix(path.relative(opts.root, abs));
			const keys =
				rel.startsWith('..') || path.isAbsolute(rel) ? [abs_key] : [abs_key, JSON.stringify(rel)];
			assignments.push(`m[${keys.join('] = m[')}] = ${JSON.stringify(entries)};`);
		}
		const source = dedent`
			import { register_router_css_paths } from 'ogygia/internal/register';
			const m = {};
			${assignments.join('\n')}
			register_router_css_paths(m);
		`;
		return `${source}\n`;
	}

	// @why `$app/paths` has no `base` on Kit 3, and Kit 2's was page-relative during SSR; Kit's build define is the configured base, root-absolute (test: test/router-css.test.ts › prod: registers each root with a handoff thunk (region_css key + Kit's configured base))
	lines.push(`import { region_css } from 'ogygia:server/region-deps';`);
	lines.push(
		`const base = typeof __SVELTEKIT_PATHS_BASE__ !== 'undefined' ? __SVELTEKIT_PATHS_BASE__ : '';`
	);
	for (let i = 0; i < roots.length; i++) {
		const abs = roots[i];
		const key = router_css_key(opts.root, abs);
		lines.push(`import __OgRcss${i} from ${JSON.stringify(abs)};`);
		lines.push(
			`register_router_css(__OgRcss${i}, () => region_css(${JSON.stringify(key)}).map((h) => ({ key: h, href: base + h })));`
		);
	}
	return `${lines.join('\n')}\n`;
}
