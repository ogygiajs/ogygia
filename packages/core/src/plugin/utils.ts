/**
 * `ogygia/plugin/utils` — small pure helpers several plugins need. No context, no state: safe to
 * import anywhere (a browser bundle included).
 */

/** Sticky 32-bit FNV-1a — uniform and deterministic, not cryptographic. */
export { fnv1a32 } from '../contract/hash.ts';
/** An attribute value with `&` and `"` escaped (unchanged, uncopied, when it has neither). */
export { escape_amp_quot as escapeAttr } from '../escape.ts';
/** Text content with `&`, `<` and `>` escaped (unchanged, uncopied, when it has none). */
export { escape_text as escapeText } from '../escape.ts';
/** The regex `\s` over one char code: ASCII whitespace and the Unicode spaces. */
export { is_space as isSpace } from '../server/html-scan.ts';
/** HTML from a template, each value escaped for where it sits (text, a quoted attribute, a URL
 *  attribute); `Html` values (from `html`, `attr`, `trustedHtml`) are markup placed as is.
 *  `html.svelte` is for markup written into a Svelte template (.svelte / .svx source): every
 *  value's `{` and `}` escaped too, so an author's text never becomes an expression. */
export { html, attr, trusted_html as trustedHtml, Html, type HtmlValue } from '../html.ts';
/** HTML text made plain again (a `<title>`'s content): its character references decoded. */
export { decode_text as decodeText } from '../html.ts';
/** A byte- and count-bounded LRU map (a process-local cache that can never grow without bound). */
export { SizedLru } from '../server/sized-lru.ts';
/** The receipt tag one `(source, args)` call files, or null for a function not declared with
 *  `import.meta.og.source`. */
export { source_tag_of as sourceTag } from '../source.ts';
/** A block of text written indented in the source, with its common indent and its leading and
 *  trailing blank lines gone; as a tag, values go in after (a long or multi-line string). */
export { dedent } from '../contract/dedent.ts';
/** The Standard Schema interface (standardschema.dev): validate a value with any schema library. */
export type { StandardSchemaV1, StandardResult, StandardIssue } from './standard-schema.ts';
/** The stable cross-build key for a markup module's own scoped CSS. */
export { content_css_key, content_css_key as contentCssKey } from '../contract/content.ts';
