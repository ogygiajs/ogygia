/**
 * WHAT DRAWS DIFFERENTLY IN THE BROWSER: the lines of a `.svelte` component that make its first
 * browser render differ from the server's — the cause a hydration mismatch (Svelte threw the server
 * DOM away) or a markup change on wake most often has, named by line:
 *
 * - `await`: an `await` at the top level of the instance script (an async component: the browser
 *   awaits again, and another answer — or a fetch the browser cannot make — draws another tree);
 * - `browser`: a value only the browser has, read while rendering — `typeof window`, `window.` /
 *   `document.` / `navigator.` / `localStorage` / `sessionStorage`, `Date.now()`, `new Date()`,
 *   `Math.random()`, `matchMedia(` — in the markup, or at the top level of the script (a `$derived`,
 *   a `const`), never inside a function, an effect or an event handler (those run after the wake).
 *
 * String scanning, line by line (no regex, no parser): brace depth tells the top level of the
 * script; a markup line's handler attributes (`onclick={…}`) are left out.
 */
export interface Hazard {
    line: number;
    /** the line, trimmed */
    code: string;
    kind: 'await' | 'browser';
    /** what it reads (`window.location`, `Date.now()`), for `browser` */
    reads?: string;
    /** an `if (…)` at the script's top level: a guard around browser-only work, which may draw the
     *  same markup both sides — a lead for a mismatch seen, not a prediction of one */
    guard?: true;
}
/** a hazard with the file it is in (the profiler's island chunks, the dev server's module graph) */
export type IslandHazard = Hazard & {
    file: string;
};
/** "In its own code, the likeliest: X.svelte:4 (`…`) awaits …; Y.svelte:8 reads Date.now( while rendering …" —
 *  said the same by the profiler's report and the devtools' Page tab */
export declare function hazard_words(lines: readonly IslandHazard[]): string;
/** The fix for those lines: what to do with each kind. */
export declare function hazard_fix(lines: readonly IslandHazard[]): string;
export declare function hydration_hazards(source: string): Hazard[];
