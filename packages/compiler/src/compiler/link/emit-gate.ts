/**
 * Island-chunk emit gate — which prescanned islands the CLIENT leg should actually build.
 *
 * The prescan registers every marked import under the app's `src/` (both build legs, so ids agree),
 * and the client leg used to emit a chunk for each of them. But a registered island is not an island
 * the app SERVES: a host module nothing imports — a second route tree's pages built from the same
 * source, a retired component — is dead weight, and worse than weight: its imports enter a client
 * build whose server pass never analysed them (an island importing a `.remote.ts` there fails Kit's
 * "Expected to find metadata for remote file" check and the build stops).
 *
 * Kit builds the SERVER bundle first. Its transform pass is the ground truth for reachability — the
 * driver records every module id it transforms there (`Program.ssr_transformed`), the plugin writes
 * the set under Kit's `outDir` at the end of that leg, and the client leg reads it back and emits
 * only islands whose host is in it. No handoff (standalone builds, a client-only build) → emit all,
 * the previous behaviour.
 */
import path from 'node:path';
import { host_key } from '../program.ts';

export const SSR_HOSTS_HANDOFF = 'og-ssr-hosts.json';

/** `<outDir>/og-ssr-hosts.json` — written by the server leg, read by the client leg (`ServerHandoff`). */
export function ssr_hosts_handoff_path(out_dir: string): string {
	return path.join(out_dir, SSR_HOSTS_HANDOFF);
}

/**
 * Should an island whose host module is `host_path` get a client chunk? `loaded` is the server
 * leg's transformed-module set (`host_key`-normalised), or `null` when there is no handoff.
 * An island with no recorded host (a library island registered through a bridge) is always emitted.
 */
export function island_host_loaded(
	host_path: string | null | undefined,
	loaded: Set<string> | null | undefined
): boolean {
	if (!loaded) return true;
	if (!host_path) return true;
	return loaded.has(host_key(host_path));
}

/** A server-only region and the component file it renders (`Compiler.server_island_css_roots`). */
export interface ServerRegionRoot {
	iid: string;
	abs: string;
}

/**
 * What the server leg hands the client leg when it ends. `hosts`: every module it transformed (the
 * emit gate). `server_regions`: its FINAL server-only regions, a library host it reached late
 * included: the client leg builds each one's styles from this list, since in Kit 2 its own program
 * never sees a host only the server bundle imports (test/server-region-late.test.ts).
 */
export interface ServerHandoff {
	hosts: string[];
	server_regions: ServerRegionRoot[];
}

/** Parse the handoff file. A malformed one gates nothing and names no region (never a throw on shape). */
export function parse_server_handoff(json: string): {
	loaded: Set<string>;
	server_regions: ServerRegionRoot[];
} {
	const raw: unknown = JSON.parse(json);
	const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<
		Record<keyof ServerHandoff, unknown>
	>;
	const hosts = Array.isArray(o.hosts) ? o.hosts : [];
	const regions = Array.isArray(o.server_regions) ? o.server_regions : [];
	return {
		loaded: new Set(hosts.filter((x): x is string => typeof x === 'string')),
		server_regions: regions.filter(
			(r): r is ServerRegionRoot =>
				!!r && typeof r === 'object' && typeof r.iid === 'string' && typeof r.abs === 'string'
		)
	};
}
