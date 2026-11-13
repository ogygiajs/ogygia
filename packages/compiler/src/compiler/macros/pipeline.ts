/**
 * The module-macro pipeline — the ordered `import.meta.og.*` passes that run BEFORE either branch
 * (island transform / svelte compile / ts-region minting) sees a module: `wire`, `$`, `store`,
 * auto-branding, `code`/`md`, and `bake`. Each pass is a no-op unless its exact marker is present, is
 * extension-aware, and (where it matters) AST-precise. Pulled out of the Vite adapter so the whole
 * macro leg is one call (`Compiler.macros`) the driver owns. Pure over `(source, id, ctx)` apart from the `dollarHoists` map it fills and the profiler
 * timing it records; returns `{ code, touched }` (the caller invalidates its own sourcemap on touch).
 */
import path from 'node:path';
import { rewrite_wire } from './wire.ts';
import { rewrite_dollar } from './dollar.ts';
import { rewrite_source } from './source.ts';
import { rewrite_store, auto_brand_stores } from './store.ts';
// `bake` is imported LAZILY (only inside the marker guard below): a build that uses no
// `import.meta.og.bake` never loads bake.js (or Vite's build for it) at all.
import type { AliasEntry } from './bake.ts';
import type { Profiler } from '../driver.ts';
import { OgygiaError } from '../messages.ts';
import { find_og_calls } from '../parse/scan.ts';

/** A plugin's `import.meta.og.<name>` macro (registered with `b.macro`). */
export interface PluginMacro {
	name: string;
	handler: (
		code: string,
		m: { id: string; rel: string; root: string; markupExts: readonly string[] }
	) => string | Promise<string>;
}

// ── regexes
const EXPORT_CONST_RE = /export\s+const/;

/** The `import.meta.og.*` macros a first-party plugin compiles: its package, and what to list. */
// static: the first-party plugins' macros
const MACRO_PACKAGES: Readonly<Record<string, { package: string; plugin: string }>> = {
	code: { package: '@ogygia/content', plugin: 'content()' },
	md: { package: '@ogygia/content', plugin: 'content()' },
	loader: { package: '@ogygia/content', plugin: 'content()' },
	regions: { package: '@ogygia/content', plugin: 'content()' }
};

/** Does `code` really call `import.meta.og.<name>(…)` (a marker in a string or comment is no call)? */
function calls_macro(code: string, name: string): boolean {
	return find_og_calls(code, 'import.meta.og.').some(
		(c) => c.method === name || c.method.startsWith(`${name}.`)
	);
}

const CONSTRUCT_MARKUP_EXTS = ['.svelte'] as const;

export interface MacroPipelineCtx {
	root: string;
	/** Resolved Vite aliases the `bake` pass hands to its mini-bundler. */
	resolveAlias: unknown[];
	/** ogygia's own package root — auto-brand skips ogygia source. */
	pkgRoot: string;
	/** Filled with every `import.meta.og.$` hoist (tag → factory source) for the fn-manifest emit. */
	dollarHoists: Map<string, string>;
	/** The plugins' macros, in plugin order (after core's, before `bake`). */
	macros?: readonly PluginMacro[];
	/** Is `id` the app's own source, or a file a package declares in `ogygia.files`? Only those may
	 *  use a macro: anywhere else one fails the build (`macro_outside_app`), and a `bake` never runs. */
	ownSource: (id: string) => boolean;
}

/**
 * Run the ordered macro passes over one module. `source` is the CURRENT text (a content-preset tag
 * or an earlier pass may already have edited it upstream) — never the raw file — because each pass
 * feeds the next. Returns the rewritten code and whether anything changed.
 */
export async function run_module_macros(
	source: string,
	id: string,
	ctx: MacroPipelineCtx,
	profiler: Profiler
): Promise<{ code: string; touched: boolean }> {
	let out = source;
	let touched = false;
	// (an installed file a package did not declare: a macro that WOULD rewrite it fails the build;
	// a marker it only names, in a string or a comment, rewrites nothing; test/macros-own-source.test.ts)
	const own = ctx.ownSource(id.split('?')[0]!);
	const refuse = (macro: string): never => {
		throw new OgygiaError('macro_outside_app', { file: id.split('?')[0]!, macro });
	};

	// `import.meta.og.wire` — the transportable-codec key, rewritten to `Symbol.for('ogygia.wire')`
	// BEFORE either branch (island transform / svelte compile / ts region minting) sees the code,
	// so the class body's computed key is a real symbol expression by compile time. Extension-aware
	// and AST-precise (see og-wire.ts); a no-op unless the marker is actually present.
	if (out.includes('import.meta.og.wire')) {
		const rewritten = rewrite_wire(out, id, CONSTRUCT_MARKUP_EXTS);
		if (rewritten !== out) {
			if (!own) refuse('wire');
			out = rewritten;
			touched = true;
		}
	}

	// `import.meta.og.$(fn)` — hoist a function so its VALUE crosses a boundary as a fn
	// ref (og-dollar.ts). Exact marker ('.$state' can never match) + AST verification.
	if (out.includes('import.meta.og.$')) {
		const rel_dollar = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		const res = rewrite_dollar(out, id, rel_dollar, CONSTRUCT_MARKUP_EXTS);
		if (res.code !== out) {
			if (!own) refuse('$');
			out = res.code;
			touched = true;
			for (const h of res.hoists) ctx.dollarHoists.set(h.tag, h.factory_src);
		}
	}

	// `import.meta.og.source(fn)` — declared data sources for the postrender reverse index:
	// stamps `file#export`, rewrites to `__og_source('id', fn)` + injects the runtime wrapper.
	// AST-precise, strict-position (macros/source.ts); a no-op unless the marker is present.
	if (out.includes('import.meta.og.source')) {
		const rel_source = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		const rewritten = rewrite_source(out, id, rel_source, CONSTRUCT_MARKUP_EXTS);
		if (rewritten !== out) {
			if (!own) refuse('source');
			out = rewritten;
			touched = true;
		}
	}

	// `import.meta.og.store(factory)` — assert a store factory: registered under a build
	// tag at module load, products branded (og-store.ts).
	if (out.includes('import.meta.og.store')) {
		const rel_store = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		const rewritten = rewrite_store(out, id, rel_store, CONSTRUCT_MARKUP_EXTS);
		if (rewritten !== out) {
			if (!own) refuse('store');
			out = rewritten;
			touched = true;
		}
	}

	// AUTO-BRAND provable store factories (export const x = (seed) => store-shape) so the
	// registered-factory tier needs zero authoring for the common shapes. App source only —
	// never node_modules (their factories can't self-register on the client anyway).
	if (!id.includes('node_modules') && !id.startsWith(ctx.pkgRoot) && EXPORT_CONST_RE.test(out)) {
		const rel_auto = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		const branded = auto_brand_stores(out, id, rel_auto, CONSTRUCT_MARKUP_EXTS);
		if (branded !== out) {
			out = branded;
			touched = true;
		}
	}

	// The PLUGINS' macros (`b.macro`: content's `code` / `md` / `loader` / `regions`), in plugin
	// order — each called only when its marker is present. Before the island transform, so whatever a
	// macro injects (a region value, region imports) flows through it like hand-written code.
	// Only on the app's own source: elsewhere a handler never runs (it may read files or run code,
	// #761), and a real call fails the build (test/macros-own-source.test.ts).
	if (ctx.macros?.length) {
		let rel: string | undefined;
		for (const macro of ctx.macros) {
			if (!out.includes(`import.meta.og.${macro.name}`)) continue;
			if (!own) {
				if (calls_macro(out, macro.name)) refuse(macro.name);
				continue;
			}
			rel ??= path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
			const rewritten = await macro.handler(out, {
				id: id.split('?')[0],
				rel,
				root: ctx.root,
				markupExts: CONSTRUCT_MARKUP_EXTS
			});
			if (rewritten !== out) {
				out = rewritten;
				touched = true;
			}
		}
	}

	// A first-party plugin's macro with its plugin not listed fails the build naming the package,
	// never a bare TypeError at run time (test/macros-need-plugin.test.ts).
	if (out.includes('import.meta.og.')) {
		for (const call of find_og_calls(out, 'import.meta.og.')) {
			const name = call.method.split('.')[0]!;
			const pkg = MACRO_PACKAGES[name];
			if (pkg === undefined || ctx.macros?.some((m) => m.name === name)) continue;
			if (!own) refuse(name);
			throw new OgygiaError('macro_needs_plugin', {
				file: id.split('?')[0]!,
				macro: name,
				package: pkg.package,
				plugin: pkg.plugin
			});
		}
	}

	// `import.meta.og.bake(fn)` — run fn at build (rolldown-bundle the imports it uses +
	// execute), devalue-serialize the result, inline it as a literal, and drop imports that only
	// fed a baked fn. Extension-aware (whole file for .ts/.js, `<script>` blocks for .svelte).
	// Runs before the island transform so downstream sees plain data, not a call.
	if (out.includes('import.meta.og.bake')) {
		const __bk = profiler.P ? performance.now() : 0;
		const { rewrite_bake, has_bake_call } = await import('./bake.ts'); // lazy — keeps bake's node-only graph out of the worker
		// (found, never run: a bake outside the app's own source executes nothing)
		if (!own && has_bake_call(out, id, CONSTRUCT_MARKUP_EXTS)) refuse('bake');
		const rewritten = await rewrite_bake(out, id, {
			alias: ctx.resolveAlias as AliasEntry[],
			root: ctx.root,
			markupExts: CONSTRUCT_MARKUP_EXTS
		});
		if (rewritten !== out) {
			out = rewritten;
			touched = true;
		}
		if (profiler.P) {
			profiler.prof.bakeMs += performance.now() - __bk;
			profiler.prof.bakeN++;
		}
	}

	return { code: out, touched };
}
