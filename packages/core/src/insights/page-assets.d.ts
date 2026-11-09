/**
 * THE PAGE'S WEIGHT — every file the rendered document makes the browser fetch at start, found in
 * the HTML and weighed through the app. Not only the islands: the page's own `<script>`s, every
 * `modulepreload` (a Kit-hydrated page lists its whole start graph there), the modules an inline
 * script imports (Kit's start/app entries), each module's STATIC imports followed to the end,
 * stylesheets (and which of them block the first paint), fonts and images preloaded or in the
 * markup. A page that ships 6 MB of JS shows 6 MB here, whatever made it.
 *
 * Two halves: `scan_assets` (pure: HTML in, references out — string scanning, no regex) and
 * `weigh_assets` (fetches each once through the app, decoded + gzip-estimated sizes, follows static
 * imports, bounded in time and count). The score (score.ts) reads the totals.
 */
import { type UnscopedStyles } from '../unscoped-css.ts';
export type AssetKind = 'script' | 'style' | 'font' | 'image' | 'other';
export interface AssetRef {
    url: string;
    kind: AssetKind;
    /** the browser must have it before the first paint (a head stylesheet, a classic sync script) */
    blocking: boolean;
    /** how the document asks for it (`island`: the runtime loads it to wake an island) */
    via: 'script' | 'modulepreload' | 'preload' | 'stylesheet' | 'inline-import' | 'img' | 'static-import' | 'island' | 'route-node' | 'runtime-phase';
    /** loads later, on demand (an island that wakes when visible / on interaction), not at start */
    lazy?: boolean;
    /** the ogygia runtime's own script (`data-ogygia-runtime`): the parts it loads itself are its own */
    runtime?: true;
    /** a part of the ogygia runtime it loads on demand as islands wake (and what that part imports) */
    phase?: true;
}
export interface WeighedAsset extends AssetRef {
    /** decoded bytes (what the browser parses) */
    bytes: number;
    /** bytes on the wire: the response's own when it was compressed, else a gzip estimate */
    wire: number;
    /** what the build put in it (its source files and packages, readable), when the build said */
    contains?: string[];
    /** a font's `Vary` header, as the server answered it */
    vary?: string;
}
export interface PageAssets {
    assets: WeighedAsset[];
    /** components whose styles shipped WITHOUT their scope (the build's fallback marker, in a
     *  stylesheet or an inline `<style>`): their rules apply to the whole page */
    unscoped?: (UnscopedStyles & {
        in: string;
    })[];
    /** references that could not be weighed (a 404, a timeout, the budget ran out) */
    missed: string[];
    /** each of those, and why: `budget` (time ran out before it), `timeout`, `status 404`, `file cap`,
     *  `error: …` — a total with only `status` misses can be trusted; `budget` / `timeout` ones vary */
    missed_why?: {
        url: string;
        why: string;
    }[];
    /** the HTML itself */
    html: {
        bytes: number;
        wire: number;
    };
    /** inline `<script>` / `<style>` text in the document, decoded bytes */
    inline: {
        script: number;
        style: number;
    };
    totals: {
        js: number;
        js_wire: number;
        css: number;
        css_wire: number;
        font: number;
        image: number;
        /** every byte at start, on the wire (HTML included) */
        wire: number;
        /** JS that loads later, on demand (lazy islands), decoded — not in `js` */
        lazy_js: number;
        /** blocking the first paint: stylesheets + classic sync scripts, decoded */
        blocking: number;
        blocking_count: number;
        js_files: number;
    };
}
/** Attributes of one start tag (`<tag a="1" b c='2'>`), names lower-cased; valueless → ''. */
export declare function tag_attrs(tag: string): Map<string, string>;
/** `import("x")` / `import('x')` specifiers in a script's text (Kit's inline start). */
export declare function dynamic_imports(text: string): string[];
/**
 * The STATIC imports of a bundled module (`import{a}from"./x.js"`, `import"./y.js"`,
 * `export*from"./z.js"`): specifiers after `from` / a bare `import` that look like module paths
 * (relative or absolute, ending in .js/.mjs). Bundler output writes them plainly; a string that
 * merely contains such text inflates nothing that does not exist — every hit is fetched, and a
 * miss is dropped.
 */
export declare function static_imports(code: string): string[];
/**
 * A Kit-hydrated page's route nodes: its inline start script passes `node_ids: [0, 5]` to
 * `kit.start`, and `app.js` imports each node on demand (`import("../nodes/5.<hash>.js")`) — the
 * page's OWN code, the heaviest part, reachable only through that dynamic import. Empty when the
 * page is not Kit-hydrated.
 */
export declare function kit_node_ids(script: string): number[];
/** Every file the document asks for at start, in document order, deduped by URL (the first,
 *  strongest ask wins: a blocking stylesheet stays blocking). Inline script/style bytes counted. */
export declare function scan_assets(html: string): {
    refs: AssetRef[];
    inline: {
        script: number;
        style: number;
    };
    kit_nodes: number[];
};
export interface Weight {
    bytes: number;
    wire: number;
    /** a module's static imports (resolved to absolute paths), for the walk */
    imports?: string[];
    /** its dynamic imports (resolved) — followed only where the page names them (Kit's route nodes) */
    dynamic?: string[];
    /** a stylesheet's unscoped fallbacks (see unscoped-css.ts) */
    unscoped?: UnscopedStyles[];
    /** a font's `Vary` header (Safari refetches a font preload that varies by Origin when its
     *  @font-face comes late) */
    vary?: string;
}
/** Resolve a reference against the page (and a module's import against its module). */
export declare function resolve_ref(ref: string, base: string): string | null;
export interface WeighOptions {
    /** the page URL references resolve against */
    page_url: string;
    fetch_url: (url: string) => Promise<Response>;
    /** per-URL cache across reports (a hashed asset never changes) */
    cache: Map<string, Weight | null>;
    /** gzip a body to estimate its wire size (node:zlib in the profiler; absent = decoded size) */
    gzip?: (bytes: Uint8Array) => number;
    budget_ms?: number;
    max_files?: number;
    /** the document the refs came from */
    html: string;
    /** files the HTML does not name but the page loads: islands' modules (lazy ones marked) */
    extra?: AssetRef[];
    /** what the build put in a file (by its absolute URL), for naming a hashed chunk */
    contents_of?: (url: string) => string[] | null;
}
export declare function weigh_assets(opts: WeighOptions): Promise<PageAssets>;
export interface AssetChange {
    /** the file's name now (or then, for one that is gone) */
    name: string;
    /** what the build put in it — the identity across builds (hashed names change every build) */
    contains?: string[];
    a: number;
    b: number;
    lazy?: boolean;
}
export interface AssetsDiff {
    /** JS at start, decoded, then → now */
    js: {
        a: number;
        b: number;
    };
    lazy_js: {
        a: number;
        b: number;
    };
    added: AssetChange[];
    removed: AssetChange[];
    grew: AssetChange[];
    shrank: AssetChange[];
    /** the same file, now loaded at start (it loaded later before: an island's wake changed) */
    to_start: AssetChange[];
    /** the same file, now loaded later (it loaded at start before) */
    to_later: AssetChange[];
}
/**
 * WHAT CHANGED IN THE PAGE'S JS between two weighings (two builds): the files new, gone, grown and
 * shrunk. Hashed names change every build, so a file is known by what the build put in it (its
 * source files and packages, `contains`), and by its URL only when the build said nothing. Changes
 * under 5 KB are left out; each list is heaviest first.
 */
/** What a diff needs of a weighing: the report's JSON carries this much too (a CI compare). */
export interface WeighedLike {
    assets: {
        url: string;
        kind: string;
        bytes: number;
        contains?: string[];
        lazy?: boolean;
    }[];
    totals: {
        js: number;
        lazy_js: number;
    };
}
export declare function assets_diff(a: WeighedLike, b: WeighedLike): AssetsDiff;
export interface RuntimeScripts {
    files: number;
    /** decoded */
    bytes: number;
    /** on the wire (a third of decoded where the browser saw none: a cached file) */
    wire: number;
    /** by who serves them: `this app`, or a CDN package / host */
    by: {
        who: string;
        files: number;
        bytes: number;
    }[];
    /** of this app's, the island entry files (`og-region.<id>.…js`): islands no HTML named — the ones
     *  a hole's answer brought */
    island_entries?: number;
}
/**
 * SCRIPTS LOADED AT RUNTIME — what the browser fetched that neither the HTML nor any module's
 * imports name: a script that loads more scripts (a CDN component library fetching its parts, a tag
 * manager, a runtime's on-demand chunk). The server cannot see them coming; the profiler user's own
 * visit saw them. `until`: the end of "at start" on the visit's clock (a lazy island woken by a
 * scroll later does not count). Null when there are none.
 */
export declare function runtime_scripts(assets: readonly {
    url: string;
}[], resources: readonly {
    url: string;
    type: string;
    start: number;
    size?: number;
    transfer?: number;
}[], origin: string, until: number): RuntimeScripts | null;
