/**
 * A component's source with every `<style>` block's CONTENT blanked: each character a space,
 * newlines kept, so every offset is the source's own (edits made from the parse land on the
 * original, and a `source.slice(ast.css.start, ast.css.end)` still reads the real style).
 *
 * For the passes that parse a RAW component (before any preprocessor) and never read its styles:
 * Svelte's parser reads `<style>` as plain CSS, and a valid `<style lang="scss">` with SCSS-only
 * syntax (`#{$i}`, `@each`, `@for`) throws `css_expected_identifier`. Those passes then skipped the
 * file in silence: the barrel rewrite left its imports on their barrels (the island shipped the
 * whole barrel), the island transform left its region imports untransformed.
 *
 * A `<style>` inside a `<script>` (a template string) is script text and is left alone. String
 * scanning, no regex: it runs over every component.
 */
export declare function blank_styles(code: string): string;
