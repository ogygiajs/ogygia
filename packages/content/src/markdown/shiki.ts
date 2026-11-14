const ESCAPE_BACKSLASH = /\\/g;
const ESCAPE_BACKTICK = /`/g;
const ESCAPE_INTERPOLATION = /\$\{/g;
const LEADING_LF = /^\n/;
const TRAILING_LF = /\n$/;
const CODE_ID_META_RE = /ogygia-code-id=(\S+)/;
const CODE_ID_META_STRIP_RE = /\s*ogygia-code-id=\S+/;

/**
 * Shiki dual-theme highlighter for markdown fences + remotes.
 * Server/preprocess only — never import from client islands.
 */

import type { ShikiTransformer } from 'shiki';
import { cache, flights, STALE, type Flights } from '@ogygia/machine';
import { createHash } from 'node:crypto';
import { attr } from '@ogygia/core/plugin/utils';
import { render_fence, default_pipeline, type CodePipeline } from './code-render.ts';
import { fence_key, fence_cache_get, fence_cache_set } from './fence-cache.ts';
import type { SerializedRegion } from '../region-store.ts';
import { OgygiaError } from '../messages/build.ts';

/** A Shiki bundled theme name, or a theme object (e.g. `ThemeRegistrationResolved`). */
export type MarkdownThemeInput = string | { name?: string };

export type MarkdownThemePair = {
	light: MarkdownThemeInput;
	dark: MarkdownThemeInput;
};

export type MarkdownShikiOptions = {
	/**
	 * Dual themes for light/dark (default: `github-light` / `github-dark`).
	 * Pass Shiki bundled theme names or full theme objects.
	 */
	themes?: MarkdownThemePair;
	/** Languages to preload (default: svelte/ts/js/html/css/bash/json/yaml/text). */
	langs?: string[];
	/**
	 * Class on the wrapper around Shiki HTML (default `'code-only'`).
	 * Pass `false` for bare Shiki output.
	 */
	wrapperClass?: string | false;
	/**
	 * Shiki `defaultColor` (default `'light-dark()'` so `color-scheme` picks tokens).
	 */
	defaultColor?: string | false;
	/**
	 * Shiki TRANSFORMERS — the ecosystem's highlight-decoration contract (`@shikijs/transformers`
	 * for diff/focus/highlight, `@shikijs/twoslash` for typed hovers, or your own). Applied to every
	 * fence at `codeToHtml`. Core ships none; svelte.dev's inline `+++`/`---` markers are one custom
	 * transformer value.
	 */
	transformers?: ShikiTransformer[];
};

// A generous docs-friendly default. Highlighting runs at BUILD time (SSR) producing static HTML — the
// client ships zero Shiki — so loading many grammars costs nothing at runtime. Each canonical language
// also registers its Shiki aliases, so ```md, ```sh, ```ts, ```js, ```yml, ```console, … all resolve.
const DEFAULT_LANGS = [
	// web / svelte
	'svelte',
	'typescript', // ts
	'javascript', // js
	'jsx',
	'tsx',
	'html',
	'css',
	'scss',
	'sass',
	'less',
	'vue',
	'astro',
	// data / config
	'json',
	'jsonc',
	'json5',
	'yaml', // yml
	'toml',
	'ini',
	'xml',
	'graphql', // gql
	'sql',
	// shell / diff / docker
	'bash', // sh, shell, zsh
	'shellsession', // console
	'powershell', // ps, ps1
	'diff',
	'docker', // dockerfile
	'make',
	'nginx',
	// prose
	'markdown', // md
	'mdx',
	// general-purpose
	'python', // py
	'rust', // rs
	'go',
	'ruby', // rb
	'php',
	'java',
	'kotlin',
	'c',
	'cpp',
	'csharp', // cs, c#
	'swift',
	'text'
] as const;

const DEFAULT_WRAPPER = 'code-only';
const DEFAULT_COLOR = 'light-dark()';
const DEFAULT_THEMES: MarkdownThemePair = {
	light: 'github-light',
	dark: 'github-dark'
};

type Highlighter = Awaited<ReturnType<(typeof import('shiki'))['createHighlighter']>>;

export type ResolvedShiki = {
	themes: MarkdownThemePair;
	lightName: string;
	darkName: string;
	langs: string[];
	wrapperClass: string | false;
	defaultColor: string | false;
	transformers: ShikiTransformer[];
};

let active: ResolvedShiki | null = null;

/** The highlighters kept at once: a site has one config, a few at most (a snippet's, an explicit
 *  `highlight()`'s); past it the least recently used goes. */
const MAX_HIGHLIGHTERS = 4;

/** What a highlighter is made from: its key (`theme_key`), and a config with that key. */
type HighlighterAsk = { key: string; cfg: ResolvedShiki };

/** The highlighter for one set of themes and languages: started on first use and kept, but never a
 *  failed start (a grammar that failed to load), which the next highlight tries again (#248). Each
 *  set has its own (a few kept at once): a snippet, or a highlight with another config, uses the one
 *  made for its set, and a highlighter let go is disposed (`let_go`). */
const highlighters: Flights<
	HighlighterAsk,
	Highlighter,
	Pick<HighlighterAsk, 'key'>
> = flights.keyed<HighlighterAsk>()({
	name: 'shiki highlighter',
	key: ['key'],
	ignore: { cfg: 'every config with one key has the same themes and languages' },
	// (one start per key at a time; what landed is kept by `kept`, which disposes what it lets go)
	keep: 0,
	run: ({ cfg }) =>
		import('shiki').then(({ createHighlighter }) =>
			createHighlighter({
				themes: [cfg.themes.light as never, cfg.themes.dark as never],
				langs: cfg.langs
			})
		)
});

/** The highlighters made, by their key: past the cap the least recently used goes, and is
 *  disposed (as is each when the cache ends). */
const kept = cache<string, Highlighter>({
	name: 'shiki highlighters',
	max: MAX_HIGHLIGHTERS,
	onEvict: (_key, h) => h.dispose()
});

/** A theme object's name for Shiki: its own, or (it has none) one made from its contents, so two
 *  unnamed themes are two names. */
function theme_name(theme: unknown, fallback: string): string {
	if (typeof theme === 'string') return theme;
	const name = (theme as { name?: string }).name;
	return name === undefined ? `${fallback}-${theme_hash(theme)}` : String(name);
}

/** A theme object's contents, hashed: its colors tell it apart, not its name. */
function theme_hash(theme: unknown): string {
	return createHash('sha256').update(JSON.stringify(theme)).digest('hex').slice(0, 16);
}

/** A theme as the key names it: a bundled one by its name, an object by its name and contents (an
 *  object edited in place keeps its name and is another theme). */
function theme_id(theme: unknown, name: string): string {
	return typeof theme === 'string' ? name : `${name}#${theme_hash(theme)}`;
}

export function normalize_shiki(options: MarkdownShikiOptions = {}): ResolvedShiki {
	const given = options.themes ?? DEFAULT_THEMES;
	const lightName = theme_name(given.light, 'light');
	const darkName = theme_name(given.dark, 'dark');
	// (an unnamed object is handed to Shiki under the name made for it)
	const named = (theme: unknown, name: string) =>
		typeof theme === 'string' || (theme as { name?: string }).name !== undefined
			? theme
			: { ...(theme as object), name };
	const themes = {
		...given,
		light: named(given.light, lightName),
		dark: named(given.dark, darkName)
	} as MarkdownThemePair;

	return {
		themes,
		lightName,
		darkName,
		langs: [...(options.langs ?? DEFAULT_LANGS)],
		wrapperClass: options.wrapperClass === undefined ? DEFAULT_WRAPPER : options.wrapperClass,
		defaultColor: options.defaultColor === undefined ? DEFAULT_COLOR : options.defaultColor,
		transformers: options.transformers ?? []
	};
}

export function configure_shiki(options: MarkdownShikiOptions = {}): ResolvedShiki {
	active = normalize_shiki(options);
	return active;
}

export function get_shiki_config(): ResolvedShiki | null {
	return active;
}

function theme_key(cfg: ResolvedShiki) {
	const light = theme_id(cfg.themes.light, cfg.lightName);
	const dark = theme_id(cfg.themes.dark, cfg.darkName);
	return `${light}|${dark}|${cfg.langs.join(',')}`;
}

async function get_highlighter(cfg: ResolvedShiki) {
	const key = theme_key(cfg);
	const have = kept.get(key);
	if (have !== undefined) return have;
	const h = await highlighters.get({ key, cfg });
	if (h === STALE) return h;
	// (two callers that joined one start both land here: the first keeps it, the second finds it)
	if (kept.peek(key) === undefined) kept.set(key, h);
	return h;
}

export function wrap_html(html: string, wrapperClass: string | false): string {
	if (!wrapperClass) return html;
	return `<div class="${wrapperClass}">${html}</div>`;
}

/** Escape for embedding inside a Svelte `{@html \`…\`}` template (mdsvex highlighter). */
export function escape_svelte(html: string): string {
	return html
		.replace(ESCAPE_BACKSLASH, '\\\\')
		.replace(ESCAPE_BACKTICK, '\\`')
		.replace(ESCAPE_INTERPOLATION, '\\${');
}

/** Wrap plain fence HTML in the svelte-embeddable form the COMPONENT path needs. The region emitter
 *  reverses this exactly (see `region-emit.ts` `unescape_svelte`) — the pair is a lossless codec. */
export function fence_embed(plain_html: string) {
	return `{@html \`${escape_svelte(plain_html)}\`}`;
}

/**
 * Highlight a code string. Uses the config from the last {@link configure_shiki} /
 * {@link markdown} call, or pass options explicitly.
 */
export async function highlight(
	code: string,
	lang: string = 'typescript',
	options?: MarkdownShikiOptions,
	/** Raw fence infostring — passed to Shiki as `meta.__raw` so meta-reading transformers
	 *  (`transformerMetaHighlight` for `{1-3,5}`, word highlight, `// [!code …]`) can read it. */
	rawMeta?: string
): Promise<string> {
	const cfg = options ? normalize_shiki(options) : active;
	if (!cfg) {
		throw new OgygiaError('content_highlight_unconfigured');
	}
	const highlighter = await get_highlighter(cfg);
	// (nothing drops a highlighter's start, so this is never STALE; were it, the next one is asked)
	if (highlighter === STALE) return highlight(code, lang, options, rawMeta);
	// An unknown fence language (a `tree` file-listing, a bespoke DSL) must NOT throw — one exotic
	// fence in a large imported corpus would otherwise fail the whole build. Fall back to plain text.
	const loaded = highlighter.getLoadedLanguages();
	const safe_lang =
		lang === 'text' || lang === 'plaintext' || lang === 'txt' || loaded.includes(lang)
			? lang
			: 'text';
	return highlighter.codeToHtml(code.replace(LEADING_LF, '').replace(TRAILING_LF, ''), {
		lang: safe_lang,
		themes: {
			light: cfg.lightName,
			dark: cfg.darkName
		},
		defaultColor: cfg.defaultColor === false ? undefined : cfg.defaultColor,
		...(cfg.transformers.length ? { transformers: cfg.transformers } : {}),
		...(rawMeta ? { meta: { __raw: rawMeta } } : {})
	});
}

/** Pull the `ogygia-code-id=<id>` token that `remarkCodeIds` stashed on the fence meta. Returns the
 *  id (or null) so the highlighter can stamp it onto the `<pre>` — the build-time half of the stable
 *  `slug-code-<hash>` permalink id (see `remark-code-ids.ts`). Matches an unquoted, space-free id. */
function pluck_code_id(meta: string | undefined | null): string | null {
	if (!meta) return null;
	const m = CODE_ID_META_RE.exec(meta);
	return m ? m[1]! : null;
}

/** mdsvex `highlight.highlighter` — fences stay normal ``` in `.svx` / `.md`. mdsvex threads the fence
 *  `meta` in as the third argument, which carries the `remarkCodeIds` id token. Runs the fence pipeline
 *  (meta parsers → variants → highlight) when a `pipeline` is given; else the plain single-variant path.
 *  Output is memoized in the content-addressed fence cache (`node_modules/.ogygia/fences`) — Shiki +
 *  variant generation dominate a cold corpus compile and are pure functions of the inputs hashed below. */
/** The config fingerprint that addresses a fence in the cache — everything that shapes output EXCEPT
 *  the per-fence (lang, meta, code). Meta parsers are counted (plain functions); variants contribute
 *  their preference name + `cache_key`; transformers their `name`s. A stage whose BEHAVIOR changes
 *  while its name stays put is invisible here — bump `cacheSalt` (or version the name) while iterating. */
export function fence_config_key(
	cfg: ResolvedShiki,
	pipe: CodePipeline,
	cache_salt = ''
): string[] {
	return [
		cache_salt,
		theme_key(cfg),
		String(cfg.defaultColor),
		String(cfg.wrapperClass),
		cfg.transformers.map((t) => t.name ?? '?').join(','),
		`m${pipe.meta.length}`,
		pipe.variants.map((g) => `${g.pref.name}:${g.cache_key ?? ''}`).join(',')
	];
}

export function create_mdsvex_highlighter(
	cfg: ResolvedShiki,
	pipeline?: CodePipeline,
	cache_salt = ''
) {
	const pipe = pipeline ?? default_pipeline();
	const config_key = fence_config_key(cfg, pipe, cache_salt);
	return async function content_mdsvex_highlighter(
		code: string,
		lang: string | undefined,
		meta?: string | null
	): Promise<string> {
		// Render (or hit cache) to a serialized region, then apply the `{@html}` embedding wrap on the
		// way OUT (an mdsvex concern; the region emitter reverses it wholesale). `code()` shares the
		// exact same fence→region step but inlines the `{ html }` directly, no embedding.
		const { html } = await render_code_region(cfg, pipe, config_key, code, lang, meta);
		return fence_embed(html);
	};
}

/**
 * The core fence → SERIALIZED REGION step — shared by the mdsvex highlighter (which then embeds the
 * html) and `import.meta.og.code()` (which inlines the `{ html }` as a prebaked region). Runs the
 * meta/variant/highlight pipeline, stamps `data-lang`/`data-file`/id onto the `<pre>`, and rides the
 * content-addressed fence cache — so the same snippet renders once across a whole build. `config_key`
 * is the config fingerprint (theme, transformers, salt) already assembled by the caller.
 */
export async function render_code_region(
	cfg: ResolvedShiki,
	pipe: CodePipeline,
	config_key: ReadonlyArray<string>,
	code: string,
	lang: string | undefined,
	meta?: string | null
): Promise<SerializedRegion> {
	const key = fence_key([...config_key, lang ?? '', meta ?? '', code]);
	const cached = fence_cache_get(key);
	if (cached != null) return cached;

	// Strip our internal `ogygia-code-id=…` token from the meta before handing the REST to Shiki as
	// `__raw`, so meta transformers (`{1-3,5}` line highlight, word highlight, `// [!code …]`) read
	// the author's infostring without our bookkeeping leaking in.
	const shiki_meta = (meta ?? '').replace(CODE_ID_META_STRIP_RE, '').trim();
	const hl = (source: string, l: string, rm: string) =>
		highlight(
			source,
			l || 'text',
			{
				themes: cfg.themes,
				langs: cfg.langs,
				wrapperClass: false,
				defaultColor: cfg.defaultColor,
				transformers: cfg.transformers
			},
			rm || undefined
		);

	const { html, count, file } = await render_fence(code, lang || 'text', shiki_meta, pipe, hl);

	const id = pluck_code_id(meta);
	let plain: string;
	if (count > 1) {
		// Multi-variant container: stamp the permalink id on the outer `<div class="og-code">`.
		const tagged = id
			? // (a function: the value is placed as written, `$` patterns in it never expanded)
				html.replace('<div class="og-code"', () => `<div${String(attr('id', id))} class="og-code"`)
			: html;
		plain = wrap_html(tagged, cfg.wrapperClass);
	} else {
		// Single variant: stamp `data-lang` + id + the pipeline's `file` (chrome draws the filename
		// bar from `attr(data-file)`) on the `<pre>` — a fence with none stays byte-identical. Each is
		// author text, escaped as an attribute value (#435).
		const lang_attr = attr('data-lang', lang && lang !== 'text' ? lang : null);
		const attrs = `${String(lang_attr)}${String(attr('id', id))}${String(attr('data-file', file || null))}`;
		const tagged = attrs ? html.replace('<pre ', () => `<pre${attrs} `) : html;
		plain = wrap_html(tagged, cfg.wrapperClass);
	}
	const out: SerializedRegion = { html: plain };
	fence_cache_set(key, out);
	return out;
}
