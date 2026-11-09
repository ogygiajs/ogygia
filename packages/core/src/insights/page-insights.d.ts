import type { RegionRefusal } from '../runtime/region-endpoint-url.ts';
import { type IslandHazard } from './hydration-hazards.ts';
import { type CpuFn, type CpuSummary } from './cpu.ts';
import { type ThirdParty } from './third-party.ts';
export interface PageIsland {
    fp: string;
    entry?: string;
    t0: number;
    loaded: number;
    turn?: number;
    done: number;
    /** when its effects had run (a microtask after `hydrate()`), when later than `done`: its own work
     *  ended there — `done` is when it could answer a click */
    fx?: number;
    recovered?: boolean;
    changed?: boolean;
    /** another script edited it before it woke; the runtime put the server markup back */
    healed?: boolean;
    ssr_bytes?: number;
    /** its arrived markup's block markers unpaired [openers, closers]: rewritten on the way */
    markers?: [number, number];
}
export interface PageInteraction {
    name: string;
    t: number;
    ms: number;
    /** input → its handlers began (the main thread was busy) */
    delay: number;
    /** the handlers */
    processing: number;
    /** handlers done → the next frame painted */
    presentation: number;
    target: string;
    fp?: string;
    /** (`forced`: of a script's time, the browser laying the page out because it read sizes after a change) */
    scripts?: {
        url: string;
        fn: string;
        invoker: string;
        ms: number;
        phase: 'delay' | 'handler' | 'paint';
        island?: string;
        forced?: number;
    }[];
}
/** The slowest interaction, sampled (JS Self-Profiling): the functions that ran while it waited and
 *  in its handlers, by their source-mapped names. `t`: which interaction (its start). */
/** The document's steps before its first byte (ms). */
export interface NavPhases {
    redirect?: number;
    worker?: number;
    dns?: number;
    connect?: number;
    tls?: number;
    /** the request until the server's first byte */
    wait?: number;
}
/** One in-app navigation (the router's body swap), on the page's clock. */
export interface PageNav {
    from: string;
    to: string;
    type: string;
    t: number;
    /** the new page's HTML arrived */
    fetched: number;
    /** its stylesheets were in */
    styled: number;
    /** the swap committed: the new page shows */
    swapped: number;
    /** the fetch split, from the page request's timing: the wait for the first byte, the download */
    server?: number;
    download?: number;
    bytes?: number;
    /** the request began before the click (a hover prefetch) */
    prefetched?: boolean;
    /** the page request on the server (the profiler's request log): its ms, the CPU it burned, its
     *  outbound calls — what the server did with the wait */
    on_server?: {
        ms: number;
        cpu_ms: number;
        net_ms: number;
        net_count: number;
        inflight?: number;
    };
}
export interface InteractionCpuInput {
    t: number;
    /** the frames' lines are the source's (mapped through a source map): else a line is the served
     *  code's, and only the function and its file are quoted */
    mapped?: boolean;
    wait: {
        ms: number;
        top: CpuFn[];
    } | null;
    handler: {
        ms: number;
        top: CpuFn[];
    } | null;
}
/** THE PROFILER'S LAST RUN OF A PAGE, in brief (devtools: the dock's profile store, shared with the
 *  Profiler tab) — what the server did when it rendered that page */
export interface ServerProfileBrief {
    /** minutes since the run */
    ago_min: number;
    render_ms: number;
    /** its top cost, in its own words (the report's first warning, else its heaviest component) */
    top: string | null;
    calls: number;
    calls_ms: number;
    /** the Cache-Control it saw the page answer, when that keeps the page out of the back/forward
     *  cache (no-store): the server's own answer, which the browser cannot read */
    no_store?: string;
    /** the page is prerendered: 'file' (the build's file answered, no render), 'route' (its route prerenders) */
    prerendered?: 'file' | 'route';
}
export interface PageInput {
    /** measured on the dev server (it compiles a page on its first request: a slow first byte there is
     *  not the app's) */
    dev?: boolean;
    /** DEVTOOLS ONLY (the profiler's report is itself a profile): the profiler's last run of this
     *  page, and of the pages it navigated to by path. Present (even empty) means: say what the server
     *  did, or how to find out */
    server_profiles?: Record<string, ServerProfileBrief>;
    server_profile?: ServerProfileBrief;
    /** the slowest interaction's CPU, when a trace of it was taken */
    interaction_cpu?: InteractionCpuInput;
    /** what held the document open: its streamed promises by `page.data` key — when each settled
     *  (`side` 'server': left the server, ms into the render, from the profiled render's chunks;
     *  'browser': arrived, ms from the navigation, stamped by the resolve global) */
    held_open?: HeldOpen;
    vitals: {
        ttfb?: number;
        fcp?: number;
        lcp?: number;
        cls?: number;
        inp?: number;
    };
    visit: {
        nav?: {
            dcl?: number;
            load?: number;
            res_start?: number;
            /** the browser gave the request and the first byte as 0 (Safari, a cross-origin-isolated
             *  page): no `res_start` — what needs the first byte is missing, not zero */
            start_hidden?: true;
            /** the document's last byte */
            res_end?: number;
            /** the document's body, decoded (bytes) */
            size?: number;
            /** the document came down as large as it is: sent without gzip or brotli */
            raw?: true;
            dom_interactive?: number;
            /** the steps before the first byte, each only when it took time */
            phases?: NavPhases;
            /** the document's own Server-Timing entries */
            server_timing?: {
                name: string;
                ms: number;
                desc?: string;
            }[];
        };
        /** main-thread ms per script URL, from long animation frames (from the page's start) */
        scripts?: {
            url: string;
            ms: number;
            count: number;
        }[];
        /** Svelte's hydration warnings (dev): the server and the browser disagreed, Svelte kept the server's */
        warnings?: {
            code: string;
            message: string;
            file?: string;
            fp?: string;
            t?: number;
        }[];
        /** (`lcp_priority`: the largest paint's own fetchpriority, when it sets one) */
        paints?: {
            fcp?: number;
            lcp?: number;
            lcp_fp?: string;
            lcp_tag?: string;
            lcp_url?: string;
            lcp_replaced?: true;
            lcp_lazy?: true;
            lcp_priority?: 'high' | 'low';
            held?: {
                outcome: 'arrived' | 'input' | 'cap' | 'none';
                resources: number;
                waited_ms: number;
            };
        };
        resources?: {
            url: string;
            type: string;
            start: number;
            end: number;
            req_start?: number;
            res_start?: number;
            transfer?: number;
            size?: number;
            blocking?: boolean;
            weighed?: true;
        }[];
        /** every file by type, when the visit lists only some of them one by one */
        resource_totals?: {
            type: string;
            count: number;
            transfer: number;
            size: number;
        }[];
        viewport?: [number, number];
        /** the page's origin (third parties are every other one) */
        origin?: string;
        /** URLs the document itself names (its scripts, preloads, their imports): a script not among
         *  them was loaded at runtime by another script */
        named?: string[];
        /** without `named` (the live page): other origins' URLs the document holds now (script src,
         *  link href). A script of theirs not among them came by an import or a fetch from another
         *  script; one among them that started after parsing was added by a script */
        in_page?: string[];
        /** files a preload fetched and something else downloaded again (the preload went unused) */
        preload_misses?: PreloadMiss[];
        /** preloads (image, font, stylesheet) nothing on the page used 3 s after load */
        preloads_unused?: {
            url: string;
            as: string;
            bytes: number;
        }[];
        /** text files (scripts, stylesheets, JSON…) of 4 KB or more that came down as large as they are
         *  decoded: sent without gzip or brotli, the largest first (the document's own: `nav.raw`) */
        uncompressed?: {
            url: string;
            type: string;
            bytes: number;
        }[];
        /** the `@font-face` rules behind the fonts it fetched (family, font-display, the fetched files) */
        font_faces?: {
            family: string;
            display: string;
            urls: string[];
        }[];
        /** images whose pixels are 4× or more what their box shows (the screen's pixel ratio counted),
         *  their files 50 KB or more: natural and shown sizes, the file's bytes, the island it is in */
        images_oversized?: {
            url: string;
            natural: [number, number];
            shown: [number, number];
            dpr: number;
            bytes: number;
            fp?: string;
        }[];
        /** long frames (50 ms or more) that began while the page scrolled, with their two biggest scripts */
        /** (`island`: the island whose file the script is, when the profiler named it from the build's chunks) */
        scroll_jank?: {
            start: number;
            ms: number;
            scripts: {
                url: string;
                fn: string;
                invoker: string;
                ms: number;
                island?: string;
            }[];
        }[];
        /** scripts that forced style and layout (5 ms or more): their window, the forced ms, the
         *  script's file and entry function (an island's hydration shows as the runtime's own task) */
        forced_layout?: {
            start: number;
            end: number;
            ms: number;
            url: string;
            fn: string;
        }[];
        /** images more than a screen and a half down, not lazy, 20 KB or more, fetched before load ended */
        images_eager_below?: {
            url: string;
            top: number;
            bytes: number;
            fp?: string;
        }[];
        /** the srcs of shown images the browser could hold no room for (computed aspect-ratio `auto`);
         *  empty: it looked and found none */
        images_unsized?: string[];
        /** the page's size in elements, when 1,500 or more: the deepest nesting, the element with the
         *  most children, the islands holding the most (depth 0: past 60,000, only counted) */
        dom?: {
            nodes: number;
            depth: number;
            deepest: string;
            widest: {
                at: string;
                children: number;
            };
            islands: {
                fp: string;
                nodes: number;
            }[];
        };
        /** islands whose own file failed to load and fell back to their stable name (the page came
         *  from a build whose files are gone); `name` when the reader could name the island */
        entry_fallbacks?: {
            entry: string;
            src: string;
            recovered: boolean;
            name?: string;
        }[];
        /** content-named files the browser fetched again (revalidated, or downloaded on a reload);
         *  `name` when the reader could name the island */
        refetched?: {
            url: string;
            how: 'revalidated' | 'downloaded';
            bytes: number;
            ms: number;
            entry?: string;
            runtime?: boolean;
            name?: string;
        }[];
        /** the slowest interaction (the one INP reports), split by phase, with the scripts of the long
         *  frames around it; `island` on a script when the reader could name the island its file is */
        interaction?: PageInteraction;
        /** the in-app navigations in this document */
        navs?: PageNav[];
    } | null;
    islands: PageIsland[];
    firsts: {
        fp: string;
        t: number;
        type: string;
    }[];
    shifts: {
        t: number;
        value: number;
        fp?: string;
        tag?: string;
    }[];
    longtasks: {
        t: number;
        ms: number;
    }[];
    /** `frames`: the browser has no long-task timing — these are frames drawn more than 50 ms late */
    longtasks_from?: 'frames';
    /** `boxes`: the browser has no layout-shift timing — the shifts are islands whose box changed as
     *  they woke, scored the way a layout shift is (an estimate) */
    shifts_from?: 'boxes';
    /** (`from`: a big island's window — where it starts in the markup without comments) */
    snapshots?: {
        fp: string;
        ssr: string;
        hydrated: string;
        final?: string;
        from?: number;
    }[];
    /** awake islands showing a children slot with nothing in it (read off the DOM; devtools only) */
    empty_slots?: string[];
    /** holes whose answer never came (the bus; devtools only) */
    hole_failures?: HoleFailure[];
    /** each island's app code in dev (the dev server's module graph; devtools only) */
    island_code?: IslandCode[];
    /** how long each hole's fallback showed before its answer (the bus; devtools only) */
    hole_waits?: HoleWait[];
    /** batch requests that did not carry all their holes (the bus; devtools only) */
    hole_batches?: HoleBatch[];
    /** what the restorer of a server transform reported (runtime/restore.ts `__og_restore_log`) */
    restore_events?: RestoreEvent[];
    /** islands whose fingerprint moved between two loads of this page (fp-drift.ts) */
    fp_drift?: {
        name: string;
        fp?: string;
        path?: string;
        was?: string;
        now?: string;
    }[];
    /** the dev server's pre-bundled packages (its `.vite/deps/_metadata.json`), read when the page
     *  loaded one: a package also served raw from its folder runs as two copies */
    prebundled?: string[];
    /** the browser the page ran in (`browser_of` its user agent: `Safari 26`, `Chrome 141`) */
    browser?: string;
    /** when the devtools' own dock began to show as the page loaded (open, remembered from the last
     *  page), page clock; absent when it was opened later or not at all */
    dock_open_at?: number;
    /** what islands that left the page left running (devtools/leftovers.ts; devtools only) */
    leftovers?: {
        name: string;
        intervals: number;
        listeners: string[];
        fires: number;
        last_ago?: number;
    }[];
    /** wheel / touch listeners still attached that hold scrolling (not passive), by the island (or
     *  the file) that added each (devtools/leftovers.ts; devtools only) */
    scroll_blockers?: {
        owner: string;
        type: string;
        on: string;
        forced: boolean;
    }[];
    /** what keeps the page out of the back/forward cache: who added a window `unload` listener, and
     *  the browser's own reasons when this load came from Back and was not restored (devtools only) */
    bfcache?: {
        unload: string[];
        not_restored?: string[];
    };
}
/** A restored host that went wrong: upgraded by its component before the restore reached it
 *  (`late`), or restored to markup that does not match Svelte's (`mismatch`, the dev check). */
export interface RestoreEvent {
    kind: 'late' | 'mismatch';
    /** the host's tag */
    host: string;
    /** page time */
    t: number;
    /** the first difference (mismatch) */
    diff?: string;
    /** the island holding it, when one does */
    island?: string;
}
export interface PreloadMiss {
    url: string;
    /** what the preload fetched as (font, fetch, script, css, img…) */
    type: string;
    /** the second download's bytes on the wire */
    bytes: number;
    /** the preload link's `as` and `crossorigin` (null: none) */
    as: string;
    crossorigin: string | null;
    /** the answer's `Vary` header, when the devtools read it (a font downloaded again) */
    vary?: string;
    /** a hole the runtime asked for: the preload is ogygia's own (on any endpoint path) */
    hole?: true;
}
export interface HoleWait {
    name: string;
    /** ms from the hole's fetch start to its answer's swap */
    wait_ms: number;
    /** below the first screen (its fallback is not what the visitor looks at first) */
    below_fold: boolean;
    /** its server render, per request, when known (the profiler recorded the hole's requests, or
     *  the answer's Server-Timing said) */
    server_ms?: number;
    /** its wait on the server for a render slot, before the render (Server-Timing / the profiler) */
    server_queue_ms?: number;
    /** the hole's endpoint (the devtools find its element by it: a hole has no fingerprint) */
    endpoint?: string;
    /** page times: when the fallback began to count (the paint, or the hole's own start), and its
     *  request as the browser timed it — left, first byte back, last byte. They split the wait. */
    shown_at?: number;
    left_at?: number;
    first_at?: number;
    end_at?: number;
    /** it came in ONE batch request with the holes that started with it: how many (its own part
     *  landed when the server rendered it — `first_at` is that, out of order). No browser gate held it. */
    batch_size?: number;
}
/** A batch request (runtime/frame-nav.ts) that carried fewer holes than it was sent for: the rest
 *  fetched on their own right after it. */
export interface HoleBatch {
    sent: number;
    delivered: number;
    /** the response's status (0: the request failed) */
    status: number;
    refused?: 'redirected' | 'document';
    final_url?: string;
    /** the holes it was for (names) */
    names: string[];
}
export interface IslandCode {
    fp?: string;
    name: string;
    /** the island's app code, served size in dev */
    bytes: number;
    /** its heaviest modules */
    top: {
        file: string;
        bytes: number;
    }[];
    /** re-export barrels still imported whole, with the app modules each drags in */
    barrels: {
        file: string;
        fanout: number;
    }[];
    /** its components' lines that draw differently in the browser (the dev server read their sources) */
    hazards?: IslandHazard[];
}
export interface HoleFailure {
    fp?: string;
    name: string;
    endpoint?: string;
    reason: RegionRefusal | 'error';
    final_url?: string;
    message?: string;
    attempts: number;
}
/** A region on the page, as the tab read it off the DOM. `top` is document-relative (px). */
export interface RegionFact {
    fp: string;
    name: string;
    kind: 'island' | 'lake' | 'hole';
    wake: string;
    hydrated: boolean;
    top?: number;
    height?: number;
    /** the wire bytes only this island loads (a build's island graph × the browser's sizes) */
    own_bytes?: number;
    /** it draws nothing on this screen: no box of its own nor a child's (hidden by its CSS, or empty) */
    hidden?: true;
    /** the media query under which the page's CSS shows it (read off the sheets), when one does */
    shows_at?: string;
    /** it never draws: no text, only `hidden` marker elements — an island there for its effects */
    headless?: true;
}
export interface Failure {
    fp?: string;
    message: string;
    /** its wake → the failure (page clock): the island was loading, and held its turn, meanwhile */
    span?: [number, number];
    /** when its hydrate step began (page clock): from here to the failure it held the thread, as a
     *  hydrating island does */
    turn?: number;
}
export type Rating = 'good' | 'fair' | 'poor';
export interface RatedVital {
    key: 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'inp';
    label: string;
    value: number;
    rating: Rating;
}
export interface IslandRow {
    fp: string;
    name: string;
    wake: string;
    /** wake began → module + hydrate core loaded */
    load_ms: number;
    /** loaded → its scheduler turn (the queue behind other islands, and the DCL/paint gate) */
    queue_ms: number | null;
    /** the synchronous hydrate step */
    hydrate_ms: number;
    t0: number;
    done: number;
    recovered: boolean;
    changed: boolean;
    /** layout shift (summed) this island caused within a moment of hydrating */
    shift: number;
    /** long-task ms that overlapped its hydration window */
    longtask_ms: number;
    /** the first interaction reached it before it was awake (ms early), when it did */
    early_ms: number | null;
    below_fold: boolean;
    /** main-thread CPU sampled inside its hydrate window (null: no trace) */
    cpu_ms: number | null;
}
export type Severity = 'error' | 'warn' | 'info';
export interface HeldOpen {
    side: 'server' | 'browser';
    keys: {
        key: string | null;
        at: number;
    }[];
    /** server side: the early part's last byte left at `early_ms`, the tail's (`late_bytes`) at `late_ms` */
    early_ms?: number;
    early_bytes?: number;
    late_ms?: number;
    late_bytes?: number;
    /** server side: the islands the page renders (the finding needs some to be about) */
    islands?: number;
}
/**
 * The page seed's defer ids → the `page.data` key each stands for (top level and one level down):
 * the seed (`application/ogygia-page`, the flat devalue form) holds a defer marker `[name, i]` per
 * streamed promise, the marker's payload the id the streamed resolve script settles. From the whole
 * document's HTML or the seed script's own text. indexOf only.
 */
export declare function defer_keys(html: string, marker?: string): Map<number, string>;
export interface PageFinding {
    code: string;
    severity: Severity;
    message: string;
    fix?: string;
    /** the islands it is about (to light up on the page) */
    fps: string[];
    /** it is the dev server's own doing: its first compile of the page (a slow first byte while the
     *  page compiled on its first request), or the CSS it adds with JavaScript moving the page (a
     *  shift). A reload reads it differently: "since your last load" never calls it new or fixed */
    dev_compile?: true;
}
export interface PageReport {
    vitals: RatedVital[];
    rows: IslandRow[];
    findings: PageFinding[];
    /** blocking resources before first paint, slowest first */
    blocking: {
        url: string;
        ms: number;
        bytes: number;
    }[];
    bytes: {
        type: string;
        count: number;
        transfer: number;
        size: number;
    }[];
    longtask_ms: number;
    /** other origins on this page (null: none, or no origin to tell them by) */
    third_party: ThirdParty | null;
}
/** The browser a page ran in, by name and major version (`Safari 18`, `Chrome 141`, `Firefox 133`,
 *  `Edge 141`), from its user-agent string by plain search; null when it says nothing known. Some
 *  findings are one engine's (Safari reports no layout shifts; a preload one engine reuses another
 *  fetches again): the profiler's report and the Page tab name which. */
export declare function browser_of(ua: string | undefined): string | null;
/** The engine family a user agent runs on: what makes two browsers measure a page differently (Edge
 *  and Chrome are one; Safari reports no layout shifts and refetches a preload Chromium reuses). */
export declare function engine_of(ua: string | undefined): 'chromium' | 'webkit' | 'gecko' | null;
/** The packages a dev server's `_metadata.json` `optimized` keys name: `svelte/internal/client` →
 *  `svelte`, `@scope/lib/x` → `@scope/lib`, `ogygia > @neodrag/svelte` (a dependency's dependency) →
 *  `@neodrag/svelte`, each once. */
export declare function prebundled_names(keys: readonly string[]): string[];
/**
 * ONE PACKAGE, TWO COPIES ON THE DEV SERVER: of the scripts the page loaded, the ones served raw from a
 * package's folder (`/node_modules/<pkg>/…`, not `.vite/`) whose package Vite also pre-bundled — each
 * package once, with how many raw files and one of them. String search: it runs on the Page tab tick.
 * ogygia is one package under its two names (`ogygia` re-exports `@ogygia/core`): an app pre-bundles
 * `ogygia/…` while the compiler's imports load core's files raw.
 */
export declare function dev_two_copies(urls: readonly string[], prebundled: readonly string[]): {
    pkg: string;
    raw: number;
    example: string;
}[];
/**
 * THE INLINE THRESHOLD THAT TAKES THE SMALL SHEETS OFF THE PAINT: Kit inlines its route stylesheets
 * under `inlineStyleThreshold` (ogygia's island sheets follow the same setting), as `<style>` in the
 * HTML — no request to wait on. Of the blocking build stylesheets (`/_app/immutable/`), the smallest
 * first, while each is 8 KB or less and the HTML grows by 24 KB at most: the threshold that inlines
 * them (just over the largest, in whole KB), how many, how many bytes. Null under two sheets. The
 * profiler's page weight (`style`) and the Page tab's resources (`css`) both ask it.
 */
export declare function inline_threshold_tune(blocking: readonly {
    url: string;
    kind: string;
    bytes: number;
}[]): {
    threshold: number;
    files: number;
    bytes: number;
} | null;
/** a page of this many elements or more is named (the beacon reports from the same count) */
export declare const DOM_LARGE = 1500;
export declare function rate(key: RatedVital['key'], value: number): Rating;
/** Two markups that differ, and differ only in percent-encoding (`a/b` against `a%2Fb`): equal
 *  once both are decoded. A stray `%` that is not an escape (text reading "50%") makes it `false`. */
export declare function encoding_only(a: string, b: string): boolean;
/** Where two strings first differ, as a short "server … / now …" pair (the markup-changed proof). */
export declare function first_difference(a: string, b: string, span?: number): {
    at: number;
    server: string;
    now: string;
} | null;
/** At the first difference `at`: an attribute of a CUSTOM ELEMENT empty on the server (`name=""`)
 *  that the browser holds as `"true"` / `"false"` — written bare (Svelte hands a custom element its
 *  attributes as values, and a bare one's is `true`; measured: `={true}` and `=""` agree on both
 *  sides). Its name, the element's tag, the browser's value. */
export declare function boolean_attr_at(server: string, now: string, at: number): {
    name: string;
    tag: string;
    now: 'true' | 'false';
} | null;
export declare function analyze_page(page: PageInput, regions: RegionFact[], failures?: Failure[], now?: number, cpu?: CpuSummary | null): PageReport;
/**
 * THE LARGEST PAINT, EXPLAINED: the element, the island it is in, and its four parts — the wait for
 * the HTML's first byte, the delay before the browser began fetching its resource (the image found
 * late: in CSS, added by a script, lazy), the resource's download, and the delay after it arrived
 * before it painted (blocking CSS or scripts, or the element shown by a script). A text paint has
 * no resource: first byte, then render. The fix is for the part that cost most.
 */
/** THE FONT THE LARGEST PAINT WAITED FOR: a text paint (no file of its own) that came within 200 ms
 *  of a font file landing after the first paint, whose face hides its text until then (font-display
 *  auto/block). The page's text was there all along, invisible: the font, not the server, set the
 *  LCP. Shared by the Page tab's split and the profiler's LCP gap. */
export declare function lcp_font(visit: PageInput['visit'] | null | undefined): {
    family: string;
    file: string;
    end: number;
} | null;
/** WHAT THE LARGEST PAINT'S DOWNLOAD SHARED THE NETWORK WITH: images far below the first screen,
 *  not lazy, whose own download overlapped the largest paint's file (or, a text paint, the wait from
 *  the first byte to the paint). Shared by the Page tab's split and the profiler's LCP gap. */
export declare function lcp_rivals(visit: PageInput['visit'] | null | undefined): {
    bytes: number;
    files: string[];
} | null;
/**
 * WHY THE BROWSER FOUND THE LARGEST PAINT'S FILE LATE, from what the visit saw: a CSS background
 * (found only once its stylesheet is in and the element laid out), an image its island's code added
 * as it woke (the request began after it hydrated: the server HTML had none), or an `<img>` in the
 * HTML at the low priority an image starts at. The generic advice when none of them is it.
 */
export declare function late_found(p: NonNullable<NonNullable<PageInput['visit']>['paints']> | undefined, res: {
    start: number;
    req_start?: number;
} | undefined, islands: readonly PageIsland[], name_of: (fp: string | undefined) => string): string;
/**
 * A VITAL'S PARTS, as numbers (the same splits the explanations word): TTFB by its steps, FCP by
 * first byte / HTML / blocking / render, LCP by first byte / delay / download / render, INP by the
 * slowest interaction's wait / handlers / paint. What "since your last profile" (the profiler) and
 * "since your last load" (the Page tab) compare, to say which part of a moved vital moved. Null
 * when the visit cannot tell.
 */
export type PartedVital = 'ttfb' | 'fcp' | 'lcp' | 'inp';
export interface VitalPart {
    key: string;
    label: string;
    ms: number;
}
export interface VitalMove {
    key: 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'inp';
    a: number;
    b: number;
    /** the part of a split vital that moved most (≥ 50 ms, else left out) */
    part?: {
        label: string;
        a: number;
        b: number;
    };
}
/**
 * WHICH VITALS MOVED between two visits of a page, past the noise, and for a split vital the part
 * that moved most. ONE rule for both tools: the profiler's "since your last profile" and the Page
 * tab's "since your last load" read the same moves. `parts(side, key)` gives a side's parts.
 */
export declare function vitals_moved(a: Record<string, number | undefined>, b: Record<string, number | undefined>, parts: (side: 'a' | 'b', key: PartedVital) => VitalPart[] | null): VitalMove[];
export declare function vital_parts(page: PageInput, key: PartedVital): VitalPart[] | null;
/**
 * THE DOCUMENT HELD OPEN: the page painted early, but its HTML kept coming — and islands wake only
 * once the whole document is in (DOMContentLoaded, the wake gate), so every island waited for its
 * end, even one that reads nothing late. Usually a load's streamed promise: the response stays open
 * until the last one settles. From the browser (the navigation's first and last byte, the paint,
 * the islands' hydrate steps after the end) and, when known, what held it (`held_open`: each streamed
 * promise by its `page.data` key and when it settled). With no visit, the profiled render alone
 * says it (its chunks: the early part, then the tail after the longest pause).
 */
export declare function explain_held_open(page: PageInput, rows: readonly IslandRow[], name_of: (fp: string) => string): PageFinding | null;
/** Names with their copies counted: `BatchHole ×4`, `Menu and Cart ×2`. */
/**
 * On the dev server: how much of an island's code load was the server COMPILING files on this
 * request — the time (overlaps counted once) the server took to answer each file fetched in its load
 * window, when that took 80 ms or more (a transform: a warm dev server answers in a few). 0 off the
 * dev server, or when the visit does not list the files.
 */
export declare function dev_compile_ms(page: Pick<PageInput, 'dev' | 'visit'>, r: Pick<IslandRow, 't0' | 'load_ms'>): number;
