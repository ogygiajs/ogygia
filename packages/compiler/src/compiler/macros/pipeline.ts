import path from 'node:path';
import { noop } from '@ogygia/machine';
import { wire_edits } from './wire.ts';
import { dollar_edits } from './dollar.ts';
import { source_edits } from './source.ts';
import { store_edits, auto_brand_edits } from './store.ts';
import type { StepMap } from '../map-chain.ts';
import { splice_map, splice_text, type Edit } from '../splice.ts';
import type { Profiler } from '../driver.ts';
import type { FoucAlias } from '../fouc-css.ts';
import { OgygiaError } from '../messages.ts';
import { find_og_calls } from '../parse/scan.ts';

/** A resolved Vite alias (`resolve.alias`, normalized to its array form). */
export type AliasEntry = FoucAlias;

/** What a macro knows about the module it rewrites. */
export interface MacroContext {
	/** The module id, query stripped. */
	readonly id: string;
	/** The id relative to the app root, POSIX (a stable identity for stamps). */
	readonly rel: string;
	readonly root: string;
	/** The app's resolved aliases (`$lib`, …), for a macro that resolves or bundles imports. */
	readonly alias: readonly AliasEntry[];
	/** Markup extensions whose `<script>` blocks hold the macro calls (`.svelte`). */
	readonly markupExts: readonly string[];
	/** Name a file the rewrite read: an edit to it transforms this module again (dev). */
	watch(file: string): void;
}

/** A plugin's `import.meta.og.<name>` macro (registered with `b.macro`). */
export interface PluginMacro {
	name: string;
	handler: (code: string, m: MacroContext) => string | Promise<string>;
}

const EXPORT_CONST_RE = /export\s+const/;

const MACRO_PACKAGES: Readonly<Record<string, { package: string; plugin: string }>> = {
	code: { package: '@ogygia/content', plugin: 'content()' },
	md: { package: '@ogygia/content', plugin: 'content()' },
	loader: { package: '@ogygia/content', plugin: 'content()' },
	regions: { package: '@ogygia/content', plugin: 'content()' },
	bake: { package: '@ogygia/bake', plugin: 'bake()' }
};

function calls_macro(code: string, name: string): boolean {
	return find_og_calls(code, 'import.meta.og.').some(
		(c) => c.method === name || c.method.startsWith(`${name}.`)
	);
}

const CONSTRUCT_MARKUP_EXTS = ['.svelte'] as const;

export interface MacroPipelineCtx {
	root: string;
	/** The app's resolved aliases, handed to every plugin macro (`bake` bundles with them). */
	alias: readonly AliasEntry[];
	/** ogygia's own package root — auto-brand skips ogygia source. */
	pkgRoot: string;
	/** Filled with every `import.meta.og.$` hoist (tag → factory source) for the fn-manifest emit. */
	dollarHoists: Map<string, string>;
	/** The plugins' macros, in plugin order (after core's; a `last` one after the others). */
	macros?: readonly PluginMacro[];
	/** Is `id` the app's own source, or a file a package declares in `ogygia.files`? Only those may
	 *  use a macro: anywhere else one fails the build (`macro_outside_app`), and no handler runs. */
	ownSource: (id: string) => boolean;
	/** The bundler's watch for the module being rewritten (Vite's `addWatchFile`); none outside one. */
	watch?: (file: string) => void;
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
): Promise<{ code: string; touched: boolean; maps: StepMap[] }> {
	let out = source;
	let touched = false;
	const maps: StepMap[] = [];
	const apply = (edits: readonly Edit[]): boolean => {
		const next = splice_text(out, edits);
		if (next === out) return false;
		const before = out;
		maps.push(() => splice_map(before, edits, id));
		out = next;
		touched = true;
		return true;
	};
	const own = ctx.ownSource(id.split('?')[0]!);
	const refuse = (macro: string): never => {
		throw new OgygiaError('macro_outside_app', { file: id.split('?')[0]!, macro });
	};

	if (out.includes('import.meta.og.wire')) {
		if (apply(wire_edits(out, id, CONSTRUCT_MARKUP_EXTS)) && !own) refuse('wire');
	}

	if (out.includes('import.meta.og.$')) {
		const rel_dollar = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		const res = dollar_edits(out, id, rel_dollar, CONSTRUCT_MARKUP_EXTS);
		if (apply(res.edits)) {
			if (!own) refuse('$');
			for (const h of res.hoists) ctx.dollarHoists.set(h.tag, h.factory_src);
		}
	}

	if (out.includes('import.meta.og.source')) {
		const rel_source = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		if (apply(source_edits(out, id, rel_source, CONSTRUCT_MARKUP_EXTS)) && !own) refuse('source');
	}

	if (out.includes('import.meta.og.store')) {
		const rel_store = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		if (apply(store_edits(out, id, rel_store, CONSTRUCT_MARKUP_EXTS)) && !own) refuse('store');
	}

	if (!id.includes('node_modules') && !id.startsWith(ctx.pkgRoot) && EXPORT_CONST_RE.test(out)) {
		const rel_auto = path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
		apply(auto_brand_edits(out, id, rel_auto, CONSTRUCT_MARKUP_EXTS));
	}

	if (ctx.macros?.length) {
		let rel: string | undefined;
		for (const macro of ctx.macros) {
			if (!out.includes(`import.meta.og.${macro.name}`)) continue;
			if (!own) {
				if (calls_macro(out, macro.name)) refuse(macro.name);
				continue;
			}
			rel ??= path.relative(ctx.root, id.split('?')[0]).split(path.sep).join('/');
			const started = profiler.P ? performance.now() : 0;
			const rewritten = await macro.handler(out, {
				id: id.split('?')[0],
				rel,
				root: ctx.root,
				alias: ctx.alias,
				markupExts: CONSTRUCT_MARKUP_EXTS,
				watch: ctx.watch ?? noop
			});
			if (profiler.P) {
				profiler.prof.macroMs += performance.now() - started;
				profiler.prof.macroN++;
			}
			if (rewritten !== out) {
				out = rewritten;
				touched = true;
				maps.push(null);
			}
		}
	}

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

	return { code: out, touched, maps };
}
