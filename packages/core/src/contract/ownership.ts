/** The ownership stamps the compiler writes on server output and the runtime's morph reads. */

/** The compiler's server-only stamp: Svelte's hydration never walks inside this element. */
export const OPAQUE_ATTR = 'data-og-opaque';
/** The compiler's server-only stamp on an element holding an `{@html}` BESIDE other children: its
 *  child elements may be `{@html}` content, which Svelte never walks into. (PROD output opens an
 *  `{@html}` block with the same `<!---->` as any separator, so the exact range is not knowable from
 *  the DOM; its child elements are compared by tag and position only, never entered.) */
export const HTML_PARENT_ATTR = 'data-og-html';
