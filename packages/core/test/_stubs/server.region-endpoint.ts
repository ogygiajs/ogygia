// Test stub for `ogygia:server/region-endpoint` (real one is the client/SSR-split module the
// Vite plugin mints). Unit tests only need the graph to load; nothing signs endpoints, and no SPA
// navigation ever reports known region fingerprints. A suite that wants the build's answers to name
// their inputs installs stand-ins with `set_region_endpoints` (and clears them with `null`).
import { fingerprint_of } from '../../src/contract/hash.ts';

/** The answers this module gives, each replaceable. */
export interface RegionEndpoints {
	make_region_endpoint: (entry: string, props: unknown) => string;
	mint_server_region: (entry: string, props: unknown, ttl: number, wakes: boolean) => string;
	reuse_known_region: (fp: string) => boolean;
	hole_css: (entry: string) => string[];
}
const NONE: RegionEndpoints = {
	make_region_endpoint: () => '',
	mint_server_region: () => '',
	reuse_known_region: () => false,
	hole_css: () => []
};
let ends: RegionEndpoints = NONE;

/** Install stand-ins for some of the answers (the rest stay empty), or with `null` clear them. */
export function set_region_endpoints(next: Partial<RegionEndpoints> | null): void {
	ends = next ? { ...NONE, ...next } : NONE;
}
export const make_region_endpoint = (entry: string, props: unknown): string =>
	ends.make_region_endpoint(entry, props);
export const mint_server_region = (
	entry: string,
	props: unknown,
	ttl: number,
	wakes: boolean
): string => ends.mint_server_region(entry, props, ttl, wakes);
export const reuse_known_region = (fp: string): boolean => ends.reuse_known_region(fp);
export const hole_css = (entry: string): string[] => ends.hole_css(entry);
// (real-shaped: 16 hex of entry + canonical text, which tests read off `data-og-fp`; the universal
// lane hash stands in for server/fingerprint.ts, which needs `node:crypto`)
export const region_fingerprint = (entry: string, canonical: string): string =>
	fingerprint_of(entry, '', canonical);
