import { escape_attr, escape_text } from './escape.ts';

const MADE_HERE: unique symbol = Symbol('html');

/** Markup that is safe to place as is: made by `html`, `attr` or `trusted_html` only. */
export class Html {
	readonly #markup: string;
	/** (made by this module's functions; the token keeps everyone else out) */
	constructor(token: typeof MADE_HERE, markup: string) {
		if (token !== MADE_HERE)
			throw new TypeError('Html is made by html(), attr() or trusted_html()');
		this.#markup = markup;
	}
	toString(): string {
		return this.#markup;
	}
	valueOf(): string {
		return this.#markup;
	}
}

/** What a hole of `html` takes: text (escaped), an `Html` (kept between tags), a number, or nothing
 *  (`null`, `undefined` and `false` place nothing). */
export type HtmlValue = string | number | Html | null | undefined | false;

const TEXT = 0;
const DOUBLE = 1;
const SINGLE = 2;
const DOUBLE_URL = 3;
const SINGLE_URL = 4;
const TAG = 5;
type Place = 0 | 1 | 2 | 3 | 4 | 5;

// static: a fixed list of attribute names, those whose value is a URL a browser follows or loads
const URL_ATTRS: ReadonlySet<string> = new Set([
	'href',
	'src',
	'action',
	'formaction',
	'poster',
	'cite',
	'background',
	'xlink:href'
]);
// oxlint-disable-next-line no-control-regex -- leading control characters a browser skips in a URL
const UNSAFE_URL = /^[\s\u0000-\u001f]*(?:javascript|vbscript|data)\s*:/i;
const URL_DROPPED = /[\t\n\r]/g;
const ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:.-]*$/;
// markup-ok: the html`` template's own source as its author wrote it, read to place a hole
const NAME_BEFORE_QUOTE = /([^\s"'<>/=]+)\s*=\s*$/;
const TAG_START = /[a-zA-Z/!?]/;

const places = new WeakMap<TemplateStringsArray, Place[]>();

function places_of(parts: TemplateStringsArray): Place[] {
	let out = places.get(parts);
	if (out) return out;
	out = [];
	let state: Place = TEXT;
	for (let p = 0; p < parts.length - 1; p++) {
		const part = parts[p]!;
		for (let i = 0; i < part.length; i++) {
			const c = part[i];
			if (state === TEXT) {
				if (c === '<' && TAG_START.test(part[i + 1] ?? '')) state = TAG;
			} else if (state === TAG) {
				if (c === '>') state = TEXT;
				else if (c === '"' || c === "'") {
					const name = NAME_BEFORE_QUOTE.exec(part.slice(0, i))?.[1] ?? '';
					const url = URL_ATTRS.has(name.toLowerCase());
					state = c === '"' ? (url ? DOUBLE_URL : DOUBLE) : url ? SINGLE_URL : SINGLE;
				}
			} else if (state === DOUBLE || state === DOUBLE_URL) {
				if (c === '"') state = TAG;
			} else if (c === "'") state = TAG;
		}
		out.push(state);
	}
	places.set(parts, out);
	return out;
}

function escape_single(s: string): string {
	return escape_attr(s).replaceAll("'", '&#39;');
}

function safe_url(s: string): string {
	return UNSAFE_URL.test(s.replace(URL_DROPPED, '')) ? 'about:invalid#unsafe' : s;
}

function place(value: HtmlValue, at: Place): string {
	if (value === null || value === undefined || value === false) return '';
	if (at === TEXT) return value instanceof Html ? value.toString() : escape_text(String(value));
	if (at === TAG && value instanceof Html) return value.toString();
	const s = String(value);
	switch (at) {
		case DOUBLE:
			return escape_attr(s);
		case SINGLE:
			return escape_single(s);
		case DOUBLE_URL:
			return escape_attr(safe_url(s));
		case SINGLE_URL:
			return escape_single(safe_url(s));
		default:
			throw new TypeError(
				'html: a value inside a tag sits in a quoted attribute, or comes whole from attr()'
			);
	}
}

function html_tag(parts: TemplateStringsArray, ...values: HtmlValue[]): Html {
	const at = places_of(parts);
	let out = parts[0]!;
	for (let i = 0; i < values.length; i++) out += place(values[i], at[i]!) + parts[i + 1]!;
	return new Html(MADE_HERE, out);
}

const BRACES_G = /[{}]/g;
const brace = (c: string) => (c === '{' ? '&#123;' : '&#125;');

function svelte_html(parts: TemplateStringsArray, ...values: HtmlValue[]): Html {
	const at = places_of(parts);
	let out = parts[0]!;
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		const where = at[i]!;
		const placed = place(v, where);
		const kept = v instanceof Html && where === TEXT;
		out += (kept ? placed : placed.replace(BRACES_G, brace)) + parts[i + 1]!;
	}
	return new Html(MADE_HERE, out);
}

/**
 * HTML from a template, each value escaped for where it sits. A plain `string` cannot say whether it
 * is text or markup, so a value was escaped zero times in one builder and twice in another (#435,
 * #436, #439). Here the type says it: an `Html` is markup that is safe to place as is, and every
 * other value is text, escaped for its place in the template:
 *
 * - between tags: `&`, `<`, `>`;
 * - inside a double-quoted attribute: `&`, `"`, `<`; single-quoted: `&`, `'`, `<`;
 * - inside a URL attribute (`href`, `src`, `action`, …): the same, and a `javascript:`,
 *   `vbscript:` or `data:` URL becomes `about:invalid#unsafe` (read as a URL parser reads it: tab,
 *   LF and CR dropped anywhere, the scheme included);
 * - anywhere else in a tag (an unquoted attribute, a tag name): refused, it throws.
 *
 * An `Html` value (from `html`, `attr` or `trusted_html`) is placed as is between tags, and escaped
 * like any text inside an attribute. It becomes its markup wherever a string is wanted (`String(h)`,
 * `'' + h`, a template literal).
 *
 * `html.svelte` is for markup written into a Svelte template (a `.svelte` / `.svx` source): the
 * same, and every placed value's `{` and `}` as `&#123;` / `&#125;`, so text an author wrote never
 * becomes an expression at compile time. An `Html` value between tags is placed as is, braces
 * included; one inside a tag (an `attr()`, or markup in a quoted attribute) has its braces escaped.
 *
 * @example
 * html`<a href="${url}">${label}</a>`;   // url and label escaped for their places
 * html`<pre${attr('data-lang', lang)}>`; // an optional attribute: nothing when null
 * trusted_html(highlighted, "the highlighter's own markup");
 */
export const html: {
	(parts: TemplateStringsArray, ...values: HtmlValue[]): Html;
	svelte(parts: TemplateStringsArray, ...values: HtmlValue[]): Html;
} = /* @__PURE__ */ Object.assign(html_tag, { svelte: svelte_html });

const NOTHING = /* @__PURE__ */ new Html(MADE_HERE, '');

/** One attribute with its leading space, ` name="value"`: the value escaped (and checked, for a URL
 *  attribute). `true` places the bare name; `null`, `undefined` and `false` place nothing. */
export function attr(name: string, value: string | number | boolean | null | undefined): Html {
	if (!ATTR_NAME.test(name)) throw new TypeError(`attr: "${name}" is not an attribute name`);
	if (value === null || value === undefined || value === false) return NOTHING;
	if (value === true) return new Html(MADE_HERE, ` ${name}`);
	const s = String(value);
	const v = URL_ATTRS.has(name.toLowerCase()) ? safe_url(s) : s;
	return new Html(MADE_HERE, ` ${name}="${escape_attr(v)}"`);
}

/** Markup made elsewhere and vouched for (a highlighter's output, a peer's signed document), placed
 *  as is. `why` says what makes it safe, for whoever reads the call. */
export function trusted_html(markup: string, why: string): Html {
	void why;
	return new Html(MADE_HERE, markup);
}

const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g;
const NAMED: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' '
};

/**
 * HTML text made plain again (text lifted out of markup, a `<title>`'s content): numeric character
 * references, and the named ones a serializer writes (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;`
 * `&nbsp;`), are decoded. Any other named reference stays as written. Plain text with no `&` comes
 * back as itself.
 */
export function decode_text(s: string): string {
	if (s.indexOf('&') === -1) return s;
	return s.replace(ENTITY, (whole, dec: string, hex: string, name: string) => {
		if (name) return NAMED[name]!;
		const code = dec ? Number(dec) : parseInt(hex, 16);
		return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
			? String.fromCodePoint(code)
			: whole;
	});
}
