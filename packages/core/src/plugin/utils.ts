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
/** A byte- and count-bounded LRU map (a process-local cache that can never grow without bound). */
export { SizedLru } from '../server/sized-lru.ts';
/** The receipt tag one `(source, args)` call files, or null for a function not declared with
 *  `import.meta.og.source`. */
export { source_tag_of as sourceTag } from '../source.ts';
/** The Standard Schema interface (standardschema.dev): validate a value with any schema library. */
export type { StandardSchemaV1, StandardResult, StandardIssue } from './standard-schema.ts';
/** The stable cross-build key for a markup module's own scoped CSS. */
export { content_css_key, content_css_key as contentCssKey } from '../contract/content.ts';
