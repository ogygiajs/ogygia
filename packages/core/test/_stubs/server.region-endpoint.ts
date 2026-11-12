// Test stub for `ogygia:server/region-endpoint` (real one is the client/SSR-split module the
// Vite plugin mints). Unit tests only need the graph to load; nothing signs endpoints, and no SPA
// navigation ever reports known region fingerprints.
import { fingerprint_of } from '../../src/contract/hash.ts';
export const make_region_endpoint = () => '';
export const mint_server_region = () => '';
export const reuse_known_region = (): boolean => false;
export const hole_css = (): string[] => [];
// (real-shaped: 16 hex of entry + canonical text, which tests read off `data-og-fp`; the universal
// lane hash stands in for server/fingerprint.ts, which needs `node:crypto`)
export const region_fingerprint = (entry: string, canonical: string): string =>
	fingerprint_of(entry, '', canonical);
