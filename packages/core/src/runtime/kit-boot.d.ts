export declare class KitBoot {
    #private;
    /**
     * The route fact, when the server stamped it: `<meta name="ogygia-csr" content="true">` on a
     * csr=true document. `null` when the document carries no such meta (an older document, a
     * fragment) — then the inline-script probe below decides.
     */
    static meta_of(doc: ParentNode): boolean | null;
    /** Meta first; else ONE probe over the document's inline scripts (side-channel scripts skipped). */
    static document_has(doc?: ParentNode): boolean;
    /**
     * Same check over an HTML string, bounded to the last 64 KB before `end` (pass the index of
     * `</body>`; defaults to the end of the string). A 2.6 MB document is never scanned whole: Kit's
     * boot sits at the end of the body, so the window is exact, not a heuristic. The side-channel
     * strip still applies inside the window (P0 above); a side-channel script cut by the window's
     * start cannot false-match either — its payload never carries a literal `<script` (devalue and
     * JSON escape `<`), and `#INLINE` needs one.
     */
    static html_has(html: string, end?: number): boolean;
}
/**
 * Mixed mode: on a csr=true page, Kit boots and hydrates the whole tree (including our island
 * components). THE one answer for the live document — read once (the meta, else the probe), cached
 * on the session, cleared when the router prepares the next document. Every caller (the region
 * element's guards, the router's start, the wrapper's client leg) reads this cache; none probes
 * the document on its own.
 */
export declare function kit_hydrates_page(): boolean;
export declare const html_has_kit_bootstrap: typeof KitBoot.html_has;
