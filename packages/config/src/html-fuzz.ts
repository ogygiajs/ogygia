/**
 * DIFFERENTIAL HTML FUZZING: ogygia reads and rewrites HTML with its own small scanners (regexes,
 * indexOf walks) where a full parser would cost too much per request. Each one is only right when
 * it reads what the browser reads. These helpers generate the HTML a real page can carry (odd
 * quotes, `>` and `<` inside attribute values, comments, raw-text elements whose text looks like
 * tags, any case, entities, self-closing forms, valueless and duplicate attributes), nested a few
 * levels deep, and read it with parse5, the spec parser, so a test can compare a scanner's answer
 * to the browser's.
 *
 *   fuzz(html_arb({ tags: ['meta', 'script'], attrs: ['name'], values: ['ogygia-router'] }), (html) => {
 *     const truth = elements(parse_document(html)).some((e) => e.name === 'meta' && …);
 *     expect(page_declares_router_meta(html)).toBe(truth);
 *   });
 *
 * Runs are seeded (314 unless `OGYGIA_FUZZ_SEED` says), so CI tries the same inputs every time and
 * a failure replays. `OGYGIA_FUZZ_RUNS` sets how many inputs each property tries.
 */
import fc from 'fast-check';
import {
	parse,
	parseFragment,
	defaultTreeAdapter,
	html as parse5_html,
	type DefaultTreeAdapterTypes as T
} from 'parse5';

export { fc };

/** What a generated page is made of: the words a scanner looks for, mixed with the hazards. */
export interface HtmlVocab {
	/** Element names (any case is tried; void and raw-text elements are written as the parser reads them). */
	tags: readonly string[];
	/** Attribute names. */
	attrs: readonly string[];
	/** Attribute values (each also tried with the HAZARD values). */
	values: readonly string[];
	/** Text (each also tried with the HAZARD texts), in text, comments and raw-text elements. */
	texts?: readonly string[];
	/** Keep the case of names as written (default: mixed case is tried too). */
	exact_case?: boolean;
}

/** Values a scanner trips on: markup characters, quotes, entities, a media query with `>`. */
export const HAZARD_VALUES: readonly string[] = [
	'',
	'a>b',
	'(width > 600px)',
	'<p>',
	'x" y="z',
	"it's",
	'&quot;q&quot;',
	'&amp;',
	'&gt;',
	'a b',
	'é🏝️',
	'/'
];

/** Text a scanner trips on: tag-looking text, closers, entities, unicode. */
export const HAZARD_TEXTS: readonly string[] = [
	'',
	'plain',
	'a < b > c',
	'&lt;meta name="x"&gt;',
	'</',
	'</div>',
	'<!--',
	'-->',
	']]>',
	'é🏝️ ',
	'"',
	"'"
];

/** Elements whose text the tokenizer reads raw (no tags inside), and the void ones (no end tag). */
const RAW_TEXT = new Set([
	'script',
	'style',
	'textarea',
	'title',
	'xmp',
	'iframe',
	'noembed',
	'noframes',
	'noscript'
]);
const VOID = new Set([
	'area',
	'base',
	'br',
	'col',
	'embed',
	'hr',
	'img',
	'input',
	'link',
	'meta',
	'source',
	'track',
	'wbr'
]);

/** A name in a case the parser folds back (`meta`, `META`, `mEtA`). */
function cased(name: string, exact: boolean): fc.Arbitrary<string> {
	if (exact) return fc.constant(name);
	return fc.oneof(
		{ weight: 4, arbitrary: fc.constant(name) },
		{ weight: 1, arbitrary: fc.constant(name.toUpperCase()) },
		{
			weight: 1,
			arbitrary: fc
				.array(fc.boolean(), { minLength: name.length, maxLength: name.length })
				.map((up) => [...name].map((c, i) => (up[i] ? c.toUpperCase() : c)).join(''))
		}
	);
}

/** One attribute as written: valueless, unquoted, single- or double-quoted, spaces around `=`. */
function attribute(vocab: HtmlVocab): fc.Arbitrary<string> {
	const exact = vocab.exact_case ?? false;
	const name = fc.constantFrom(...vocab.attrs).chain((n) => cased(n, exact));
	const value = fc.constantFrom(...vocab.values, ...HAZARD_VALUES);
	const eq = fc.constantFrom('=', '=', '=', ' = ', '\n=');
	return fc
		.tuple(name, value, eq, fc.constantFrom('double', 'double', 'single', 'unquoted', 'none'))
		.map(([n, v, e, form]) => {
			if (form === 'none') return n;
			if (form === 'double') return `${n}${e}"${v.replaceAll('"', '&quot;')}"`;
			if (form === 'single') return `${n}${e}'${v.replaceAll("'", '&#39;')}'`;
			// an unquoted value ends at whitespace or `>`, and can't start with a quote
			const bare = v.replace(/[\s>"'=<`]/g, '');
			return bare ? `${n}${e}${bare}` : n;
		});
}

/** The space between attributes: any HTML whitespace, a stray `/`. */
const SEP = fc.constantFrom(' ', ' ', ' ', '\t', '\n', '  ', ' / ', '\f');

function start_tag(name: string, vocab: HtmlVocab, self_close: boolean): fc.Arbitrary<string> {
	return fc
		.tuple(
			cased(name, vocab.exact_case ?? false),
			fc.array(fc.tuple(SEP, attribute(vocab)), { maxLength: 4 }),
			fc.constantFrom('', '', ' ', '\n')
		)
		.map(
			([n, attrs, tail]) =>
				`<${n}${attrs.map(([s, a]) => s + a).join('')}${tail}${self_close ? '/>' : '>'}`
		);
}

function text(vocab: HtmlVocab): fc.Arbitrary<string> {
	const pool = [...(vocab.texts ?? []), ...HAZARD_TEXTS];
	return fc.array(fc.constantFrom(...pool), { minLength: 1, maxLength: 3 }).map((t) => t.join(''));
}

/** Markup that holds a tag's TEXT but no tag: comments of every form, CDATA (a bogus comment in
 *  HTML), a processing instruction (also one), and an escaped copy of a real tag. */
function not_a_tag(vocab: HtmlVocab, tag: fc.Arbitrary<string>): fc.Arbitrary<string> {
	return fc.oneof(
		tag.map((t) => `<!--${t}-->`),
		tag.map((t) => `<!-- ${t} --!>`),
		tag.map((t) => `<![CDATA[${t}]]>`),
		tag.map((t) => `<?x ${t.replaceAll('>', '')}?>`),
		tag.map((t) => t.replaceAll('<', '&lt;')),
		fc.constantFrom('<!-->', '<!--->', '<!---->', '<!x>', '</ >', '< meta>', '<3'),
		text(vocab).map((t) => `<!--${t}-->`)
	);
}

/**
 * Generated HTML from `vocab`: elements (any case, void and self-closing forms, raw-text ones whose
 * text is tag-looking markup), text, comments and bogus comments, nested up to `vocab.depth`.
 */
export function html_arb(vocab: HtmlVocab): fc.Arbitrary<string> {
	const names = fc.constantFrom(...vocab.tags);
	// a lone start tag of a vocab element (what raw text and comments disguise)
	const lone = names.chain((n) => start_tag(n, vocab, false));
	const { node } = fc.letrec<{ node: string; nodes: string }>((tie) => ({
		node: fc.oneof(
			{ depthSize: 'small', withCrossShrink: true },
			// (text as a page writes it: a `<` in text is escaped, or it would be a tag)
			{ weight: 3, arbitrary: text(vocab).map((t) => t.replaceAll('<', '&lt;')) },
			{ weight: 2, arbitrary: not_a_tag(vocab, lone) },
			{
				weight: 5,
				arbitrary: fc
					.tuple(names, fc.boolean(), fc.constantFrom('', '', ' ', '\n'))
					.chain(([name, self_close, close_space]) => {
						const lower = name.toLowerCase();
						if (VOID.has(lower)) return start_tag(name, vocab, self_close);
						const open = start_tag(name, vocab, false);
						const close = cased(name, vocab.exact_case ?? false).map(
							(n) => `</${n}${close_space}>`
						);
						// raw text: tag-looking text inside, and sometimes a near-miss of its own end tag
						const inner = RAW_TEXT.has(lower)
							? fc
									.array(
										fc.oneof(
											text(vocab),
											lone,
											fc.constant(`</${lower}x>`),
											fc.constant(`</${lower}`)
										),
										{ maxLength: 3 }
									)
									.map((parts) => parts.join(''))
									// (a raw element's text that holds its own `</name` would end it: the parser's
									// call, but a bare `</name` at the very end can't close: keep it apart from the closer)
									.map((s) => (s.endsWith(`</${lower}`) ? s + ' ' : s))
							: tie('nodes');
						return fc
							.tuple(open, inner, close, fc.integer({ min: 0, max: 9 }))
							.map(([o, i, c, drop]) => (drop === 0 && !RAW_TEXT.has(lower) ? o + i : o + i + c));
					})
			}
		),
		nodes: fc
			.array(tie('node'), { maxLength: 4, depthIdentifier: 'html' })
			.map((parts) => parts.join(''))
	}));
	return fc.array(node, { maxLength: 6 }).map((parts) => parts.join(''));
}

/**
 * A page of `filler` (any HTML: `html_arb`) around well-formed elements `element(inner)` writes —
 * the markup ogygia itself emits (its own tags are always lower case, quoted and closed), nested
 * inside each other and around more filler.
 */
export function around(
	filler: fc.Arbitrary<string>,
	element: (inner: string) => fc.Arbitrary<string>
): fc.Arbitrary<string> {
	const { nodes } = fc.letrec<{ node: string; nodes: string }>((tie) => ({
		node: fc.oneof(
			{ depthSize: 'small', withCrossShrink: true },
			filler,
			tie('nodes').chain(element)
		),
		nodes: fc
			.array(tie('node'), { maxLength: 4, depthIdentifier: 'around' })
			.map((parts) => parts.join(''))
	}));
	return nodes;
}

/** An attribute value as Svelte writes it in a double-quoted attribute (`&`, `"` and `<` escaped). */
export function svelte_attr(value: string): string {
	return value.replace(/[&"<]/g, (c) => (c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&lt;'));
}

// ── the oracle ──────────────────────────────────────────────────────────────────────────────────

/** One element as the browser builds it. */
export interface ParsedElement {
	/** Its name, lower case (`meta`, `ogygia-region`). */
	name: string;
	/** HTML, SVG or MathML. */
	ns: 'html' | 'svg' | 'math';
	/** Its attributes as the DOM holds them: names lower case, values decoded, the first of two
	 *  same-name attributes kept. In source order. */
	attrs: Map<string, string>;
	/** Inside a `<template>`'s content (not in the document tree). */
	in_template: boolean;
	/** Its ancestors' names, nearest first. */
	ancestors: string[];
	/** Where its start tag is in the source (`[start, end)`); none for an element the parser made up. */
	start_tag?: { start: number; end: number };
	/** Where it ends in the source (just past its end tag, or its last content); none when made up. */
	end?: number;
	/** Its text, for a raw-text element (script, style, textarea, title). */
	text: string;
}

const NS: Record<string, ParsedElement['ns']> = {
	[parse5_html.NS.HTML]: 'html',
	[parse5_html.NS.SVG]: 'svg',
	[parse5_html.NS.MATHML]: 'math'
};

type Parent = T.ParentNode;

/** `html` as a whole document, the way a browser parses a response (scripting on). */
export function parse_document(html: string): T.Document {
	return parse(html, { sourceCodeLocationInfo: true });
}

/** `html` as the children of a `context` element (`'body'`, `'head'`, `'div'`), the way
 *  `innerHTML` or `createContextualFragment` parses it. */
export function parse_in(html: string, context = 'body'): T.DocumentFragment {
	const ctx = defaultTreeAdapter.createElement(context, parse5_html.NS.HTML, []);
	return parseFragment(ctx, html, { sourceCodeLocationInfo: true });
}

/** Every element in `root`, in document order, template contents included. */
export function elements(root: Parent): ParsedElement[] {
	const out: ParsedElement[] = [];
	const walk = (node: Parent, in_template: boolean, ancestors: string[]) => {
		for (const child of node.childNodes) {
			if (!('tagName' in child)) continue;
			const el = child as T.Element;
			const attrs = new Map<string, string>();
			for (const a of el.attrs) {
				const name = a.prefix ? `${a.prefix}:${a.name}` : a.name;
				if (!attrs.has(name)) attrs.set(name, a.value);
			}
			const loc = el.sourceCodeLocation;
			out.push({
				name: el.tagName,
				ns: NS[el.namespaceURI] ?? 'html',
				attrs,
				in_template,
				ancestors,
				start_tag: loc?.startTag
					? { start: loc.startTag.startOffset, end: loc.startTag.endOffset }
					: undefined,
				end: loc ? loc.endOffset : undefined,
				text: el.childNodes
					.filter((n): n is T.TextNode => n.nodeName === '#text')
					.map((n) => n.value)
					.join('')
			});
			const inner = [el.tagName, ...ancestors];
			if (el.tagName === 'template' && 'content' in el)
				walk((el as T.Template).content, true, inner);
			else walk(el, in_template, inner);
		}
	};
	walk(root, false, []);
	return out;
}

/** The comments in `root` (their text), template contents included. */
export function comments(root: Parent): string[] {
	const out: string[] = [];
	const walk = (node: Parent) => {
		for (const child of node.childNodes) {
			if (child.nodeName === '#comment') out.push((child as T.CommentNode).data);
			else if ('childNodes' in child) walk(child as Parent);
			if (child.nodeName === 'template') walk((child as T.Template).content);
		}
	};
	walk(root);
	return out;
}

/** The document's `<head>` element (parse5 always makes one). */
export function head_of(doc: T.Document): T.Element {
	const html = doc.childNodes.find((n) => n.nodeName === 'html') as T.Element;
	return html.childNodes.find((n) => n.nodeName === 'head') as T.Element;
}

/** The document's `<body>` element (parse5 always makes one, unless a frameset replaced it). */
export function body_of(doc: T.Document): T.Element | undefined {
	const html = doc.childNodes.find((n) => n.nodeName === 'html') as T.Element;
	return html.childNodes.find((n) => n.nodeName === 'body') as T.Element | undefined;
}

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const env_number = (name: string): number | undefined => {
	const v = env?.[name];
	return v ? Number(v) : undefined;
};

export interface FuzzOptions {
	/** Inputs tried. Default 300; `OGYGIA_FUZZ_RUNS` sets every property's. */
	runs?: number;
	/** The seed. Default 314, so CI tries the same inputs every time; `OGYGIA_FUZZ_SEED` sets it. */
	seed?: number;
	/** Replays one failure: the `path` a failed run printed. */
	path?: string;
}

/** Check `property` over `arb`, seeded: a failure prints the shrunk input, its seed and path. */
export function fuzz<A>(
	arb: fc.Arbitrary<A>,
	property: (input: A) => void,
	options: FuzzOptions = {}
): void {
	fc.assert(fc.property(arb, property), {
		numRuns: env_number('OGYGIA_FUZZ_RUNS') ?? options.runs ?? 300,
		seed: env_number('OGYGIA_FUZZ_SEED') ?? options.seed ?? 314,
		...(options.path ? { path: options.path } : {})
	});
}
