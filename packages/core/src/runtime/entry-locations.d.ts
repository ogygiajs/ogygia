/** A load that fell back to its identity: who hears about it (the runtime registers the devtools
 *  and beacon reporter at boot). This module imports nothing: app code (a portable snippet) uses it
 *  too, and must not pull the runtime's reporting into the app's chunks. */
export type EntryFallbackReport = {
    entry: string;
    src: string;
    recovered: boolean;
};
export declare function on_entry_fallback(reporter: (report: EntryFallbackReport) => void): void;
/** Remember where an entry is served from. `base`: the document the pair was read from. */
export declare function note_entry_location(entry: string | null | undefined, src: string | null | undefined, base?: string): void;
/** The known location of an entry, or undefined. */
export declare function entry_location(entry: string, base?: string): string | undefined;
/**
 * Pin the build map's address to the page that wrote it, as `pin_region_urls` pins a region's: with
 * Kit's default `paths.relative` it is written relative to that page, and it is read lazily — after a
 * client navigation to another depth, resolved against the new address, it named a file that is not
 * there. The runtime calls this at boot, before any navigation.
 */
export declare function pin_build_map(): void;
/**
 * PIN A REGION'S URLS TO THE PAGE THAT WROTE THEM. With Kit's default `paths.relative`, the server
 * writes `entry` / `src` / `endpoint` relative to the page it rendered (`../../_app/immutable/…`,
 * `../../__ogygia__?…`), and every reader resolves them against `location.href`. A region that stays
 * on the page through a client navigation (Kit's, or the router's) then resolved them against the
 * NEW address: its island imported `/a/b/_app/…` (a redirect to an HTML page), and a hole's key
 * changed with the depth of the page, so a swap kept the old region beside the new one. Resolved
 * once, where the address is still the right one — the element's connect, and a fetched document
 * against its own URL — they read the same on every page. Same origin only (a federated entry stays
 * as written); an absolute or root-absolute value is already pinned.
 */
export declare function pin_region_urls(el: Element, base?: string): void;
/** An island element's identity, its location noted on the way (the one read every loader uses). */
export declare function island_entry_of(el: Element): string | null;
/**
 * Import an entry: its location when known (else this build's map names it, once read); failing that,
 * or with none anywhere, the CURRENT build's location — so an island on a page that outlived its build
 * still wakes, on the current code. `url`: what the caller resolved for the identity.
 */
export declare function import_entry<T>(entry: string, url?: string): Promise<T>;
