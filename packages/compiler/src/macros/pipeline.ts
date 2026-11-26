import path from 'node:path';
import { noop } from '@ogygia/machine';
import { wire_edits } from './wire.ts';
import { dollar_edits } from './dollar.ts';
import { source_edits } from './source.ts';
import { store_edits, auto_brand_edits } from './store.ts';
import type { StepMap } from '../map-chain.ts';
import { splice_map, splice_text, type Edit } from '../splice.ts';
import type { Profiler } from '../driver.ts';
import type { AppAlias } from '../app-spec.ts';
import { OgygiaError } from '../messages.ts';
import { parse } from 'svelte/compiler';
import {
	find_og_calls,
	is_js_module,
	is_markup_module,
	markdown_expressions,
	markdown_scripts,
	og_js_regions,
	type JsRegion,
	type OgCall
} from '../parse/scan.ts';
import { line_of, walk_ast } from '../parse/ast.ts';
import type { AstNode } from '../parse/oxc.ts';
import { blank_styles } from '../blank-styles.ts';

/** A resolved Vite alias (`resolve.alias`, normalized to its array form). */
export type AliasEntry = AppAlias;

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
	/** The code a macro rewrites in this module's text `code`: a JS module whole, a `.svelte`
	 *  component's `<script>` blocks, a markdown page's (`.svx`, `.md`) `<script>` blocks (not its
	 *  fenced code); null for any other module. A call left outside them fails the build
	 *  (`macro_in_markup`), and so does one a handler leaves in a markdown page's script. */
	regions: (code: string) => JsRegion[] | null;
	/** Name a file the rewrite read: an edit to it transforms this module again (dev). */
	watch: (file: string) => void;
}

/** What a macro answers: the new code (the same string when nothing changed), or the edits that make
 *  it, which keep the module's source map. */
export type MacroResult = string | readonly Edit[];

/** A plugin's `import.meta.og.<name>` macro (registered with `b.macro`). */
export interface PluginMacro {
	name: string;
	handler: (code: string, m: MacroContext) => MacroResult | Promise<MacroResult>;
}

const EXPORT_CONST_RE = /export\s+const/;

const MACRO_PACKAGES: Readonly<Record<string, { package: string; plugin: string }>> = {
	code: { package: '@ogygia/content', plugin: 'content()' },
	md: { package: '@ogygia/content', plugin: 'content()' },
	loader: { package: '@ogygia/content', plugin: 'content()' },
	regions: { package: '@ogygia/content', plugin: 'content()' },
	bake: { package: '@ogygia/bake', plugin: 'bake()' },
	image: { package: '@ogygia/image', plugin: 'image()' }
};

const CONSTRUCT_MARKUP_EXTS = ['.svelte'] as const;

const OG_PREFIX = 'import.meta.og.';

function template_calls(code: string, id: string, scripts: readonly JsRegion[]): OgCall[] {
	let outside = false;
	for (
		let at = code.indexOf(OG_PREFIX);
		at !== -1 && !outside;
		at = code.indexOf(OG_PREFIX, at + 1)
	)
		outside = !scripts.some((s) => at >= s.offset && at < s.offset + s.code.length);
	if (!outside) return [];
	let fragment: AstNode;
	try {
		fragment = parse(blank_styles(code), { modern: true, filename: id }).fragment as AstNode;
		// oxlint-disable-next-line ogygia/no-silent-failures -- markup that does not parse has no calls to find; the Svelte compile reports it
	} catch {
		return [];
	}
	const calls: OgCall[] = [];
	walk_ast(fragment, (n) => {
		if (n.type !== 'CallExpression') return;
		const callee = code.slice(n.callee.start as number, n.callee.end as number);
		if (callee.startsWith(OG_PREFIX))
			calls.push({
				start: n.start,
				end: n.end,
				method: callee.slice(OG_PREFIX.length),
				args: ''
			});
	});
	return calls;
}

function code_regions(
	code: string,
	id: string,
	markdown_exts: readonly string[]
): JsRegion[] | null {
	if (!is_js_module(id) && is_markup_module(id, markdown_exts)) return markdown_scripts(code);
	return og_js_regions(code, id, CONSTRUCT_MARKUP_EXTS);
}

/** Where a macro call sits: in code a macro rewrites (`script`), in a markdown page's `<script>`
 *  (`markdown script`, code only some macros rewrite), or in markup no macro rewrites. */
type Place = 'script' | 'markdown script' | 'markup';

type PlacedCall = OgCall & { place: Place };

function in_regions(regions: readonly JsRegion[], place: Place): PlacedCall[] {
	return regions.flatMap((r) =>
		find_og_calls(r.code, OG_PREFIX).map((c) => ({
			...c,
			start: c.start + r.offset,
			end: c.end + r.offset,
			place
		}))
	);
}

function macro_calls(code: string, id: string, markdown_exts: readonly string[]): PlacedCall[] {
	if (!is_js_module(id) && is_markup_module(id, markdown_exts))
		return [
			...in_regions(markdown_scripts(code), 'markdown script'),
			...in_regions(markdown_expressions(code), 'markup')
		];
	const regions = og_js_regions(code, id, CONSTRUCT_MARKUP_EXTS) ?? [];
	const calls = in_regions(regions, 'script');
	if (!is_js_module(id) && is_markup_module(id, CONSTRUCT_MARKUP_EXTS))
		calls.push(
			...template_calls(code, id, regions).map((c) => ({ ...c, place: 'markup' as const }))
		);
	return calls;
}

const PLACE_TEXT: Readonly<Record<Exclude<Place, 'script'>, string>> = {
	markup: 'the markup (a template expression)',
	'markdown script': "a markdown page's <script>"
};

function calls_macro(
	code: string,
	id: string,
	markdown_exts: readonly string[],
	name: string
): boolean {
	return macro_calls(code, id, markdown_exts).some(
		(c) => c.method === name || c.method.startsWith(`${name}.`)
	);
}

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
	/** The markdown formats' extensions (`.svx`, `.md`, from `b.markup()`): their `<script>` blocks
	 *  are code a macro call in fails the build without its plugin. Optional (default none). */
	markdownExts?: readonly string[];
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
	const markdown_exts = ctx.markdownExts ?? [];
	const refuse = (macro: string): never => {
		throw new OgygiaError('macro_outside_app', {
			file: id.split('?')[0]!,
			macro
		});
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
				if (calls_macro(out, id, markdown_exts, macro.name)) refuse(macro.name);
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
				regions: (code) => code_regions(code, id, markdown_exts),
				watch: ctx.watch ?? noop
			});
			if (profiler.P) {
				profiler.prof.macroMs += performance.now() - started;
				profiler.prof.macroN++;
			}
			if (typeof rewritten !== 'string') apply(rewritten);
			else if (rewritten !== out) {
				out = rewritten;
				touched = true;
				maps.push(null);
			}
		}
	}

	if (out.includes('import.meta.og.')) {
		for (const call of macro_calls(out, id, markdown_exts)) {
			const name = call.method.split('.')[0]!;
			const pkg = MACRO_PACKAGES[name];
			if (pkg === undefined) continue;
			if (!ctx.macros?.some((m) => m.name === name)) {
				if (!own) refuse(name);
				throw new OgygiaError('macro_needs_plugin', {
					file: id.split('?')[0]!,
					macro: name,
					package: pkg.package,
					plugin: pkg.plugin
				});
			}
			if (call.place === 'script') continue;
			throw new OgygiaError('macro_in_markup', {
				file: `${id.split('?')[0]!}:${line_of(out, call.start)}`,
				macro: call.method,
				place: PLACE_TEXT[call.place],
				plugin: pkg.plugin
			});
		}
	}

	return { code: out, touched, maps };
}
