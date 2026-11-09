/**
 * THE DEVTOOLS SWITCH — whether devtools is on in this browser, in a BUILD with devtools (a QA or
 * preview deploy; the dev server always has it on). One cookie decides all of it: the launcher shows,
 * the page is measured from the start (runtime/beacon.ts), what islands leave running is watched
 * (leftovers.ts), and the server writes its event side-channel (hooks.ts). Off — the default — a
 * visitor sees nothing and pays nothing.
 *
 * A developer turns it on for their own browser, and it stays on across navigations and reloads:
 * - `?og-devtools=on` / `?og-devtools=off` on any page (the server sets the cookie on that very
 *   response, the browser too — a prerendered page has no server — and the address drops the param);
 * - `ogygia.devtools.on()` / `.off()` in the console;
 * - "hide" in the dock turns it off.
 *
 * (The value is not the `1` an earlier launcher set on a plain click: a browser that clicked the old
 * button once stays off until it opts in.)
 *
 * A plain module: the server, the runtime and the launcher all read it.
 */
export declare const DEVTOOLS_COOKIE = "og_devtools";
export declare const DEVTOOLS_ON = "on";
/** The URL param that flips it: `?og-devtools=on` / `?og-devtools=off`. */
export declare const DEVTOOLS_PARAM = "og-devtools";
/** What the URL asks for: `true` on, `false` off, `null` nothing (absent or another value). */
export declare function switch_in_url(url: URL): boolean | null;
/** The URL without the switch param (the address after it was applied). */
export declare function without_switch(url: URL): URL;
/** Is it on in a `Cookie` header / `document.cookie` string. */
export declare function switch_on_in(cookies: string): boolean;
/**
 * LEAN TESTING: `og_testing=lean` (or `?og-testing=lean`) beside the devtools switch — the testing API
 * (`window.__ogygia_testing`) works in full, and nothing else of devtools runs: no launcher, no dock, no
 * watcher of the page's timers, no server event side-channel in the HTML. The page loads what it loads
 * with devtools off, plus the testing engine when a test first asks. An engine that does not know the
 * cookie ignores it.
 */
export declare const TESTING_COOKIE = "og_testing";
export declare const TESTING_LEAN = "lean";
export declare const TESTING_PARAM = "og-testing";
/** Is lean testing asked for in a `Cookie` header / `document.cookie` string. */
export declare function lean_in(cookies: string): boolean;
/** Lean testing in this browser: the cookie, or the URL param (false off the browser). */
export declare function testing_lean(): boolean;
/** The `Set-Cookie`-shaped attributes the switch is written with (browser and server alike). */
export declare const SWITCH_COOKIE_OPTIONS: {
    path: string;
    maxAge: number;
    sameSite: 'lax';
    httpOnly: boolean;
};
/** Is it on in this browser (false off the browser, or with cookies blocked). */
export declare function devtools_switched_on(): boolean;
/** Turn it on / off in this browser (the cookie; the caller updates what shows). */
export declare function write_switch(on: boolean): void;
