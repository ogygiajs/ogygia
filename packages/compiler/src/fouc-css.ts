import path from 'node:path';
import { compile, parse } from 'svelte/compiler';
import { walk } from 'estree-walker';
import { unscoped_marker } from '@ogygia/core/contract';
import { blank_styles } from './blank-styles.ts';
import { component_blocks } from './parse/scan.ts';
import { EVERY_BARREL, ExportIndex, Shapes } from './exports/index.ts';
import { warn } from './messages.ts';
import { region_family } from './ids.ts';
import { resolve_app_spec, type AppAlias } from './app-spec.ts';

export const FOUC_CSS_PREFIX: string = region_family('fouc_css');
export const FOUC_SCOPED_PREFIX: string = region_family('fouc_scoped');

const PATH_SEP = /[/\\]/;
const STYLE_OPEN = /<style\b/i;
const STYLE_EXT = /\.(css|scss|sass|less|styl|stylus|pcss)(?:\?|$)/i;
const SVELTE_EXT = /\.svelte(?:\?|$)/i;
const IMPORT_SPEC =
	/import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+\.(?:svelte|css|scss|sass|less|styl|pcss)(?:\?[^"']*)?)["']/g;
const WIN_DRIVE_RE = /^[a-zA-Z]:/;
const PARENT_TRAVERSAL_RE = /(^|[\\/])\.\.([\\/]|$)/;

/** @param relPosix */
export function foucCssVirtualId(relPosix: string): string {
	return `${FOUC_CSS_PREFIX + encodeURIComponent(relPosix.split(PATH_SEP).join('/'))}.js`;
}

/** @param relPosix */
export function foucScopedVirtualId(relPosix: string): string {
	return `${FOUC_SCOPED_PREFIX + encodeURIComponent(relPosix.split(PATH_SEP).join('/'))}.css`;
}

/** @param id */
export function isFoucCssId(id: string): boolean {
	const bare = id.startsWith('\0') ? id.slice(1) : id;
	return bare.startsWith(FOUC_CSS_PREFIX) && bare.endsWith('.js');
}

/** @param id */
export function isFoucScopedId(id: string): boolean {
	const bare = id.startsWith('\0') ? id.slice(1) : id;
	return bare.startsWith(FOUC_SCOPED_PREFIX) && bare.endsWith('.css');
}

/** @param id */
export function foucRelFromId(id: string): string | null {
	const bare = id.startsWith('\0') ? id.slice(1) : id;
	let encoded = null;
	if (bare.startsWith(FOUC_CSS_PREFIX) && bare.endsWith('.js')) {
		encoded = bare.slice(FOUC_CSS_PREFIX.length, -'.js'.length);
	} else if (bare.startsWith(FOUC_SCOPED_PREFIX) && bare.endsWith('.css')) {
		encoded = bare.slice(FOUC_SCOPED_PREFIX.length, -'.css'.length);
	}
	if (encoded == null) return null;
	let rel: string;
	try {
		rel = decodeURIComponent(encoded);
	} catch {
		rel = encoded; // ok: not percent-encoded: the id holds the path as is (the check below still runs)
	}
	if (
		rel.startsWith('/') ||
		rel.startsWith('\\') ||
		WIN_DRIVE_RE.test(rel) ||
		PARENT_TRAVERSAL_RE.test(rel)
	) {
		return null;
	}
	return rel;
}

/**
 * Collect side-effect import specs that pull island CSS into the client graph without JS.
 * @param entryAbs absolute path to the island entry `.svelte`
 * @param opts
 */
export async function buildFoucCssModuleSource(
	entryAbs: string,
	opts: CssReachOptions
): Promise<string> {
	const entries = await collectFoucCssReachable(entryAbs, opts);
	const posix_rel = (abs: string) => path.relative(opts.root, abs).split(PATH_SEP).join('/');
	const imports: string[] = [];
	for (const e of entries) {
		if (e.kind !== 'scoped') imports.push(e.abs);
		else {
			const rel = posix_rel(e.abs);
			if (!rel.startsWith('../') && !path.isAbsolute(rel)) imports.push(foucScopedVirtualId(rel));
		}
	}
	if (imports.length === 0) {
		return 'export {}';
	}
	return `${imports.map((s) => `import ${JSON.stringify(s)};`).join('\n')}\n`;
}

/**
 * The transitive CSS-reachability walk under `buildFoucCssModuleSource`, exported on its own for the
 * server-router CSS registry (link/router-css.ts): from a component entry, in DISCOVERY ORDER (the
 * cascade order the aggregator has always imported in), every `.svelte` with a `<style>` block
 * (`kind: 'scoped'`) and every plain style-file import (`kind: 'css'`) reachable through the
 * component tree. Abs paths. Same resolution rules as the aggregator, so both stay in lockstep.
 */
export interface CssReachOptions {
	root: string;
	libDir: string;
	/** The app's files (the compiler's: `CompileCtx.read_file`). */
	readFile: (p: string) => string | null;
	/** app aliases to follow (`$lib_x/…`, `@scope/pkg/…` → source dirs) — the fallback resolver's */
	alias?: readonly AppAlias[];
	/**
	 * The bundler's own resolver (Vite's `this.resolve`): a package specifier through its `exports`
	 * (a TypeScript entry included), a workspace link, an alias — whatever the build resolves. Without
	 * it (a unit test, a host with no bundler) `$lib`, relative paths and `alias` only.
	 */
	resolve?: (spec: string, importer: string) => Promise<string | null>;
	/**
	 * The export index of `resolve` (one per bundler resolver, for the app's life), so every walk of a
	 * build goes through one parse and one resolution of each barrel. Without it, a fresh one.
	 */
	exports?: ExportIndex<WalkResolve>;
}

/** The CSS walk's resolver: the caller its export index resolves with. */
export type WalkResolve = (spec: string, importer: string) => Promise<string | null>;

/** An export index's resolve for the CSS walk: the walk hands its resolver in as the caller. */
export const through_caller = (
	spec: string,
	importer: string,
	walk_resolve: WalkResolve
): Promise<string | null> => walk_resolve(spec, importer);

const SCRIPT_MODULE_EXT = /\.(?:[cm]?[jt]sx?|svelte\.[jt]s)$/;
const RESOLVE_SUFFIXES = ['', '.ts', '.js', '/index.ts', '/index.js'];
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const ALL = '*';

/**
 * THE CSS A COMPONENT TREE REACHES — every `.svelte` with a `<style>` block (`kind: 'scoped'`) and
 * every plain style-file import (`kind: 'css'`), in DISCOVERY ORDER (the cascade order the aggregator
 * has always imported in). Abs paths.
 *
 * A subtree no client chunk carries (a server-only hole, a router page, a lake) gets its CSS from
 * here, so this walk must reach what the bundler reaches — a component imported through a workspace
 * package's TypeScript barrel came back unstyled: its specifier was not resolved, and a `.ts` module
 * was a dead end. So:
 * - specifiers resolve through the bundler's resolver (`opts.resolve`) when the build has one;
 * - a `.svelte` file is a component: all of it renders, so every import of it is followed;
 * - a script module is followed by the NAMES taken from it: through a barrel (the export index:
 *   nested barrels, `export *`), each name to its leaf, so a barrel of twenty components brings the
 *   CSS of the two imported; a module with code of its own, every import it makes (its code may
 *   render them). A dependency's own JavaScript (`node_modules`, not a barrel) is not walked: a
 *   package ships compiled code, its components as `.svelte` files a barrel names.
 */
export async function collectFoucCssReachable(
	entryAbs: string,
	opts: CssReachOptions
): Promise<Array<{ kind: 'scoped' | 'css'; abs: string }>> {
	const read = opts.readFile;
	const resolve = async (spec: string, importer: string): Promise<string | null> => {
		if (opts.resolve) {
			const id = await opts.resolve(spec, importer);
			return id ? path.normalize(id.split('?')[0]) : null;
		}
		const base = resolve_app_spec(spec, importer, opts);
		if (!base) return null;
		const clean = base.split('?')[0];
		if (STYLE_EXT.test(clean) || SVELTE_EXT.test(clean)) return path.normalize(clean);
		for (const suffix of RESOLVE_SUFFIXES) {
			const candidate = path.normalize(clean + suffix);
			if (read(candidate) != null) return candidate;
		}
		return null;
	};
	const barrels =
		opts.exports ?? new ExportIndex<WalkResolve>(through_caller, new Shapes((id) => read(id)));

	const entries: Array<{ kind: 'scoped' | 'css'; abs: string }> = [];
	const seen_css = new Set<string>();
	const seen_svelte = new Set<string>();
	const seen_names = new Map<string, Set<string>>();

	const visit = async (abs: string, names: ReadonlySet<string>, spec: string): Promise<void> => {
		if (STYLE_EXT.test(abs)) {
			if (!seen_css.has(abs)) {
				seen_css.add(abs);
				entries.push({ kind: 'css', abs });
			}
		} else if (SVELTE_EXT.test(abs)) {
			await visit_svelte(abs);
		} else if (SCRIPT_MODULE_EXT.test(abs)) {
			await visit_script(abs, names, spec);
		}
	};

	const follow = async (
		decls: ReadonlyArray<{ source: string; names: Set<string> }>,
		importer: string
	) => {
		for (const d of decls) {
			const resolved = await resolve(d.source, importer);
			if (resolved) await visit(resolved, d.names, d.source);
		}
	};

	const visit_svelte = async (abs: string) => {
		if (seen_svelte.has(abs)) return;
		seen_svelte.add(abs);
		const source = read(abs);
		if (source == null) return;
		if (svelteHasStyle(source)) entries.push({ kind: 'scoped', abs });
		await follow(listStaticImports(source, abs), abs);
	};

	const visit_script = async (abs: string, names: ReadonlySet<string>, spec: string) => {
		let done = seen_names.get(abs);
		if (!done) seen_names.set(abs, (done = new Set()));
		if (done.has(ALL)) return;
		const wanted = names.has(ALL) ? [ALL] : [...names].filter((n) => !done.has(n));
		if (!wanted.length) return;
		for (const n of wanted) done.add(n);
		const map = await barrels.map(abs, spec, EVERY_BARREL, resolve);
		if (map) {
			const own: string[] = [];
			for (const n of wanted) {
				const entry = map.entries.get(n);
				if (entry && typeof entry === 'object')
					await visit(entry.id, new Set(['namespace' in entry ? ALL : entry.name]), entry.id);
				else own.push(n);
			}
			if (!own.length && !map.opaque) return;
		}
		if (NODE_MODULES_RE.test(abs)) return;
		const shape = barrels.shapes.get(abs);
		if (!shape) return;
		await follow(
			shape.imports
				.filter((d) => !d.type_only)
				.map((d) => ({
					source: d.source,
					names: new Set(
						d.side_effect
							? []
							: d.specs
									.filter((s) => !s.type_only)
									.map((s) => (s.kind === 'namespace' ? ALL : s.imported))
					)
				})),
			abs
		);
		await follow(
			shape.exports.flatMap((e) => {
				if (e.kind === 'reexport' && !e.type_only)
					return [{ source: e.source, names: new Set([e.imported]) }];
				if ((e.kind === 'star' && !e.type_only) || e.kind === 'star_ns')
					return [{ source: e.source, names: new Set([ALL]) }];
				return [];
			}),
			abs
		);
	};

	await visit_svelte(path.normalize(entryAbs));
	return entries;
}

/** The plugin's preprocessor for a component's CSS: `<style lang="scss|sass">` to CSS, TypeScript
 *  stripped from its script (vite/style-preprocess.ts). */
export type PreprocessCss = (source: string, abs: string) => Promise<string>;

/**
 * A component's scoped CSS, one rule for every leg (dev router CSS, the build's tree CSS, the fouc
 * module): preprocessed by `preprocess`, then compiled with its script
 * (test/router-css-dev-preprocess.test.ts). With no preprocessor (a host with no bundler), the
 * source as it is.
 */
export async function scoped_component_css(
	abs: string,
	source: string,
	preprocess: PreprocessCss | undefined
): Promise<string> {
	return preprocess
		? compileFoucScopedCss(abs, await preprocess(source, abs), { keepScript: true })
		: compileFoucScopedCss(abs, source);
}

/**
 * Compile scoped CSS for a `.svelte` file (filename must match SSR for hash stability).
 * @param abs
 * @param source
 */
export function compileFoucScopedCss(
	abs: string,
	source: string,
	opts: {
		/** Keep the `<script>` (already free of TS/dialects): a template reading `$store` from an
		 *  imported store, or any script-declared name, only compiles WITH its script. Stripping it
		 *  throws on such a template and falls back to UNSCOPED style bodies — which match nothing
		 *  the SSR'd markup carries. Without it (a source that may still carry TypeScript), the
		 *  source is tried whole first (Svelte reads `lang="ts"` itself), then script-stripped. */
		keepScript?: boolean;
	} = {}
): string {
	const inputs = opts.keepScript ? [source] : [source, without_scripts(source)];
	let err: unknown;
	for (const input of inputs) {
		try {
			const result = compile(input, {
				filename: abs,
				generate: 'client',
				css: 'external',
				discloseVersion: false,
				experimental: { async: true }
			});
			return result.css?.code ?? '';
		} catch (e) {
			err ??= e;
		}
	}
	const why = (err as Error).message.split('\n')[0];
	if (opts.keepScript) warn('scoped_css_failed', { file: abs, reason: why });
	const raw = extractRawStyleBodies(source);
	return raw ? unscoped_marker(abs, why) + raw : raw;
}

/** @param source */
export function svelteHasStyle(source: string): boolean {
	return STYLE_OPEN.test(source);
}

const GLOBAL_OPEN = ':global(';

function unwrap_global(css: string) {
	let out = '';
	let i = 0;
	while (i < css.length) {
		const at = css.indexOf(GLOBAL_OPEN, i);
		if (at === -1) {
			out += css.slice(i);
			break;
		}
		out += css.slice(i, at);
		const inner = at + GLOBAL_OPEN.length;
		let depth = 1;
		let j = inner;
		for (; j < css.length && depth > 0; j++) {
			if (css[j] === '(') depth++;
			else if (css[j] === ')') depth--;
		}
		out += css.slice(inner, j - 1);
		i = j;
	}
	return out;
}

function extractRawStyleBodies(source: string) {
	return unwrap_global(
		component_blocks(source)
			.filter((b) => b.kind === 'style')
			.map((b) => source.slice(b.start, b.end))
			.join('\n')
	);
}

function without_scripts(source: string): string {
	let out = '';
	let at = 0;
	for (const b of component_blocks(source)) {
		if (b.kind !== 'script') continue;
		out += source.slice(at, b.open);
		at = b.close;
	}
	return out + source.slice(at);
}

/** A component's static imports: each specifier with the names it takes (`*` for a namespace;
 *  none for a bare `import 'x'`). Type-only imports are left out: they bring nothing at runtime. */
export function listStaticImports(
	source: string,
	filename: string
): Array<{ source: string; names: Set<string> }> {
	const out: Array<{ source: string; names: Set<string> }> = [];
	try {
		const ast = parse(blank_styles(source), { filename, modern: true });
		const scripts = [ast.instance, ast.module].filter(Boolean);
		for (const block of scripts) {
			const content = block?.content;
			if (!content || content.type !== 'Program') continue;
			walk(content, {
				enter(node) {
					if (node.type !== 'ImportDeclaration') return;
					const decl = node as {
						source?: { value?: unknown };
						importKind?: string;
						specifiers?: Array<{
							type: string;
							importKind?: string;
							imported?: { name?: string; value?: string };
						}>;
					};
					const src = decl.source?.value;
					if (typeof src !== 'string' || decl.importKind === 'type') return;
					const names = new Set<string>();
					for (const s of decl.specifiers ?? []) {
						if (s.importKind === 'type') continue;
						if (s.type === 'ImportDefaultSpecifier') names.add('default');
						else if (s.type === 'ImportNamespaceSpecifier') names.add(ALL);
						else names.add(s.imported?.name ?? s.imported?.value ?? ALL);
					}
					out.push({ source: src, names });
				}
			});
		}
	} catch {
		for (const m of source.matchAll(IMPORT_SPEC)) out.push({ source: m[1], names: new Set([ALL]) });
	}
	return out;
}
