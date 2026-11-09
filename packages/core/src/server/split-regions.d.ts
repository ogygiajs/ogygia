export type RegionKind = 'island' | 'lake' | 'hole';
export interface RegionSpan {
    /** `island` = a hydrated region (its bytes are off-limits to any post-SSR reshaping); `lake` = a
     *  frozen (`wake="none"`) subtree, server HTML the browser never re-creates; `hole` = a deferred
     *  region whose current markup is the page's fallback, not a hydration tree. */
    kind: RegionKind;
    /** Index of the `<` that opens `<ogygia-region …>`. */
    start: number;
    /** Index one past the `>` that closes `</ogygia-region>`. `[start, end)` is the whole element. */
    end: number;
    /** Index one past the `>` of the OPENING tag — the first byte of the region's inner HTML. */
    innerStart: number;
    /** Index of the `<` of the CLOSING tag — one past the last byte of the inner HTML.
     *  `[innerStart, innerEnd)` is the inner HTML a reshaping pass may edit for a lake / hole. */
    innerEnd: number;
    /** The opening tag's attributes (unquoted values). Read `wake` / `endpoint` / `entry` here. */
    attrs: Readonly<Record<string, string>>;
    /** Nesting depth — `0` for a top-level region, `1` for one directly inside a lake / hole, and so
     *  on. Island subtrees are never entered, so a region deeper than `0` is always inside a lake or
     *  hole (never inside another island). */
    depth: number;
}
/**
 * Parse a tag's attribute run (everything between the tag name and its `>`) into a lower-cased map
 * with quotes stripped. Shared by the region opener and the `<og-lift>` placeholder on restore.
 *
 * Hand-written (measured faster, no match arrays) with the rules the pattern
 * `([^\s/>=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+))?` had, quirks included: a value is a closed
 * `"…"`, else a closed `'…'`, else an unquoted run (which may start with an unclosed quote — then
 * the first and last characters are stripped, as before); `=` with no value leaves the name valueless.
 * @internal Exported for test/regex-replacements.test.ts.
 */
export declare function parse_attr_string(inner: string): Record<string, string>;
/**
 * Yield every `<ogygia-region>` in `html`, in document order, an island's subtree treated as atomic
 * (its nested regions are not yielded). One linear pass, O(html length); allocates no copy of the
 * document. See the module doc for why this exists and how to use it.
 */
export declare function scanRegions(html: string): Generator<RegionSpan, void, undefined>;
export interface LiftedRegion {
    /** `island` bytes must be restored VERBATIM (reshaping them breaks hydration); a `lake` / `hole`
     *  MAY be reshaped first via {@link LiftedRegion.withInner}. */
    readonly kind: RegionKind;
    /** The opening tag's attributes (`wake` / `endpoint` / `entry` …), lower-cased. */
    readonly attrs: Readonly<Record<string, string>>;
    /** `<ogygia-region …>` — the opening tag, verbatim. */
    readonly openTag: string;
    /** The region's inner HTML (`''` for a self-closed or unterminated region). */
    readonly innerHtml: string;
    /** `</ogygia-region>` — the closing tag (`''` for a self-closed or unterminated region). */
    readonly closeTag: string;
    /** `openTag + innerHtml + closeTag`. */
    readonly outerHtml: string;
    /** Ties this region to its `<og-lift data-i="…">` placeholder in the shell. */
    readonly index: number;
    /** A copy with the inner HTML replaced — for a lake / hole whose inner a caller has rendered. The
     *  opening / closing tags and the index are preserved. Do NOT call this for an island. */
    withInner(innerHtml: string): LiftedRegion;
}
export interface LiftResult {
    /** The document with every TOP-LEVEL region replaced by an `<og-lift data-i="…"></og-lift>`
     *  placeholder — the only part a foreign renderer should be handed. */
    shell: string;
    /** The lifted regions, in document order, index-aligned to their placeholders. */
    regions: LiftedRegion[];
}
/**
 * Lift every TOP-LEVEL `<ogygia-region>` out of `html`, leaving an `<og-lift>` placeholder where each
 * was. Hand `shell` to the foreign renderer (and, to render a lake / hole, its `innerHtml` — recurse
 * with `liftRegions` there so islands nested inside it stay protected), then {@link restoreRegions}.
 * Islands come back verbatim. A region deeper than top level rides inside its parent's `outerHtml`.
 */
export declare function liftRegions(html: string): LiftResult;
/**
 * Splice lifted regions back over their `<og-lift>` placeholders, transplanting any attributes the
 * foreign renderer stamped on a placeholder (scoped slot marks — a `sc-*` class, `c-id`, `s-sn`)
 * onto the region's opening tag. The placeholder is matched loosely because the renderer annotates
 * it; only opening-tag attributes are merged, never the region's light DOM. An unknown placeholder
 * is left in place rather than dropped.
 */
export declare function restoreRegions(shell: string, regions: readonly LiftedRegion[]): string;
