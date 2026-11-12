/**
 * SERVER-DELTA NAV: the caps on `x-ogygia-known`, the live region copies an SPA nav names. The
 * browser leaves the header out past {@link KNOWN_HEADER_CAP} (runtime/router-nav.ts), and the server
 * takes a header over either cap as no claim, so every region renders (server/region-endpoint.ts
 * `reuse_known_region`; test/property-known-copies.test.ts).
 */

/** Max bytes of the header: keeps request headers well under proxy and server limits. */
export const KNOWN_HEADER_CAP = 6144;

/** Max copies an honest browser can name under {@link KNOWN_HEADER_CAP}: 16-hex fingerprints, one
 *  comma between each (server/fingerprint.ts `region_fingerprint`). */
export const KNOWN_COPIES_CAP: number = Math.floor((KNOWN_HEADER_CAP + 1) / 17);
