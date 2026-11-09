/** Decode character references (the common named ones and every numeric one): enough to compare two
 *  serializations of the same text or attribute value. */
export declare function decode(s: string): string;
/** `document`: a page render. `region`: a region answer (a hole, a lake remount) — every custom
 *  element in it gets a plan, since the page morphs it over live hosts. */
export type TransformKind = 'document' | 'region';
interface HostRecord {
    planned: boolean;
    /** inside Svelte-owned markup (its children are hydrated): the dev check compares these */
    owned: boolean;
    attrs: Record<string, string>;
    /** child i: an element's attributes, a text node's original text */
    children: Map<number, {
        attrs?: Record<string, string>;
        text?: string;
    }>;
    /** og-t n: the original text */
    texts: Map<number, string>;
    text_next: number;
    /** the original inner HTML span, for the dev check */
    inner_start: number;
    inner_end: number;
}
export interface MarkRecord {
    kind: TransformKind;
    source: string;
    hosts: Map<number, HostRecord>;
}
/**
 * Tag `html` for the transform. `csr`: a Kit-hydrated document (its whole body is Svelte's, except
 * lakes and holes). `answer`: a document the router fetched, morphed into the live page (every host
 * planned, as in a region answer — see `plan_hosts`). Returns the tagged HTML, or `null` when there is
 * no custom element to tag (the transform then gets the HTML as is, and settle has nothing to do).
 */
export declare function mark(html: string, kind: TransformKind, csr: boolean, answer?: boolean): {
    html: string;
    record: MarkRecord;
} | null;
/** How the stand-ins keep their element's box before the restore swaps them back (zero specificity:
 *  the component's own class rules still win). */
export declare const STAND_IN_CSS: string;
export interface Settled {
    html: string;
    /** planned hosts (with a shadow plan) — the page needs the restorer */
    planned: number;
    /** stand-ins written */
    stand_ins: number;
    /** `data-og-head` assets lifted out of a document's body, for its head (deduped by key) */
    head: string[];
    /** dev: each planned Svelte-owned host's original children, for the browser's check */
    check?: Record<string, string>;
}
export declare function settle(html: string, record: MarkRecord, opts?: {
    dev?: boolean;
}): Settled;
/** The dev check's payload: each planned Svelte-owned host's original children, by its id. */
export declare function check_script(check: Record<string, string>): string;
/**
 * STABLE MARKS FOR A CACHING TRANSFORM. ogygia numbers hosts across the whole document, so the same
 * block carries other ids on another page, and a render cache keyed on its markup never hits.
 * `localizeMarks(block)` renumbers the block's marks from 0 (in order of appearance): cache on the
 * result, then `back(rendered)` puts the document's ids back on whatever the render returned.
 *
 * ```ts
 * const local = localizeMarks(block);
 * const rendered = cache.get(local.html) ?? cache.set(local.html, await render(local.html));
 * return local.back(rendered);
 * ```
 */
export declare function localizeMarks(html: string): {
    html: string;
    back: (rendered: string) => string;
};
/**
 * The whole server round trip for one piece of markup: mark → the app's transform → settle. Kit-free
 * (exported from `ogygia/markup` for tests that harvest markup and run a transform over it).
 */
export declare function transformMarkup(html: string, transform: (html: string) => string | Promise<string>, opts?: {
    kind?: TransformKind;
    csr?: boolean;
    dev?: boolean;
}): Promise<Settled>;
export {};
