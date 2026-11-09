/**
 * Component → CSS registry for the SERVER router (`@ogygia/router`, any page module).
 *
 * A router page/layout/error component is a runtime VALUE (`r.page(Home)`), so unlike a Kit route
 * there is no file-derived place to link its stylesheets from — historically its `<style>` never
 * reached the page (see link/router-css.ts for the whole story). The fix is Kit's association done
 * value-wise: the build emits `virtual:ogygia/router-css`, a generated module (never user code) that
 * imports each component the app's router modules can reach and registers it HERE with a thunk
 * yielding its stylesheet entries. `componentCssHead()` (plugin/css.ts) then looks up exactly the
 * components a render places and links them through `document()`'s head.
 *
 * The thunk shape covers both modes:
 *  - prod:  `{ key, href }` — `<link rel="stylesheet">` to the emitted asset (key = the raw handoff
 *           href, so `claim_region_css` dedupes against a held region linking the same sheet).
 *  - dev:   `{ key, css }`  — inline `<style>` text compiled at emit time (Vite dev has no built
 *           asset to link; Kit inlines dev styles the same way).
 *
 * WeakMap: components registered but never rendered cost one entry, GC'd with the module graph.
 */
export interface RouterCssEntry {
    /** Per-request dedupe key (claimed via `claim_region_css`, shared with region CSS claims). */
    key: string;
    /** Prod: stylesheet URL (base applied by the generated virtual). */
    href?: string;
    /** Dev: inline CSS text. */
    css?: string;
}
/** True once the build's page-module registry has registered at least one component. */
export declare function router_css_active(): boolean;
/** Called by the generated `virtual:ogygia/router-css` — one registration per reachable component. */
export declare function register_router_css(component: unknown, entries: () => RouterCssEntry[]): void;
/** Dev-mode registration: `abs posix source path → entries`, no component identity needed. */
export declare function register_router_css_paths(map: Record<string, RouterCssEntry[]>): void;
/** The stylesheet entries for one rendered component — [] when unregistered (no styles, or the
 *  component reached the router outside its modules' import graph; dev warns on that case). */
export declare function router_css_of(component: unknown): RouterCssEntry[];
/** Dev-only: was this component registered at all? Lets the router warn when a STYLED component
 *  reached it from outside the detected import closure (the `makeRoutes(Comp)` injection pattern). */
export declare function router_css_known(component: unknown): boolean;
