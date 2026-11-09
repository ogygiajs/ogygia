/**
 * REGION STYLESHEETS: the `<link>` (or inlined `<style>`) an answer lifted into the head, or one
 * already there with the same href.
 *
 * Its download, as a machine:
 *
 *   loading ─ loaded
 *          ╲ failed
 *
 * "In the head" is not "loaded", and a link whose download failed never loads, nor fires `load` or
 * `error` again. So an answer that finds the sheet waits only on a loading one, and puts a failed
 * one back with a fresh link, which asks for it again (#274).
 *
 * Who it is for: the regions whose answer on screen uses it, as well as the page whose server head
 * lists it. The server head never lists the sheet of an answer the server did not pick, so a
 * navigation takes a region sheet out only once the new page neither lists it nor has a region that
 * uses it: a hole kept across the navigation keeps its sheet (#275).
 */
import { type Machine } from '@ogygia/machine';
type SheetStates = {
    /** Its download is in flight. */
    loading: {};
    /** In, and styling the page. */
    loaded: {};
    /** Its download failed. It stays failed: a fresh link asks again. */
    failed: {};
};
declare const sheet_steps: {
    readonly loading: readonly ['loaded', 'failed'];
    readonly loaded: readonly [];
    readonly failed: readonly [];
};
export type RegionSheet = Machine<SheetStates, typeof sheet_steps>;
/**
 * The download of a stylesheet link, watched from the first time an answer looks at it. A link made
 * here is watched before it goes into the head, so it never misses its `load` or `error`. One that was
 * there first (the server's) counts as loaded once it has a `sheet`; one with no `sheet` yet is still
 * loading. (Chromium gives a failed link an empty sheet, so a server link that failed before anyone
 * looked counts as loaded: the page's own sheets are the page's.)
 */
export declare function sheet_of(link: HTMLLinkElement): RegionSheet;
/** `region` painted an answer that uses `sheets` (in place of the ones its answer before used). */
export declare function use_sheets(region: Element, sheets: readonly Element[]): void;
/**
 * After a navigation's swap: of the region sheets the new page's head does not list (`unlisted`),
 * take out each one no region on the page uses any more.
 */
export declare function release_sheets(unlisted: readonly Element[]): void;
export {};
