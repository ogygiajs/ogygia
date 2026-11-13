import fs from 'node:fs';
import path from 'node:path';
import { host_key } from '../program.ts';

export const SERVER_HANDOFF = 'og-server-handoff.json';

/** `<outDir>/og-server-handoff.json`: written by the server leg, read by the client leg. */
export function server_handoff_path(out_dir: string): string {
	return path.join(out_dir, SERVER_HANDOFF);
}

/** A server-only region and the component file it renders (`Compiler.server_island_css_roots`). */
export interface ServerRegionRoot {
	iid: string;
	abs: string;
}

/**
 * What the server leg used, for the client leg, which may be another plugin instance (Kit 2 loads
 * the config once per leg). A file between ogygia's own legs, under Kit's `outDir` beside the server
 * bundle that already holds the key; never shipped. `hosts`: the server bundle's transformed modules
 * (the emit gate). `build_key`: the signing key the server bundle baked, for the client bundle's
 * secret check (link/build-output.ts `refuse_client_secrets`). `server_regions`: its FINAL
 * server-only regions, a library host it reached late included: the client leg builds each one's
 * styles from this list, since in Kit 2 its own program never sees a host only the server bundle
 * imports (test/server-region-late.test.ts).
 */
export interface ServerHandoff {
	readonly hosts: Set<string>;
	readonly build_key: string;
	readonly server_regions: ServerRegionRoot[];
}

/** The handoff file's text. */
export function server_handoff_json(
	hosts: readonly string[],
	build_key: string,
	server_regions: readonly ServerRegionRoot[]
): string {
	return JSON.stringify({ hosts, build_key, server_regions });
}

/** The handoff file's contents. A malformed field reads as empty: nothing gated, no region named,
 *  never a throw. */
export function parse_server_handoff(json: string): ServerHandoff {
	const o = JSON.parse(json) as {
		hosts?: unknown;
		build_key?: unknown;
		server_regions?: unknown;
	} | null;
	const hosts = Array.isArray(o?.hosts) ? o.hosts.filter((x) => typeof x === 'string') : [];
	const regions: unknown[] = Array.isArray(o?.server_regions) ? o.server_regions : [];
	return {
		hosts: new Set(hosts),
		build_key: typeof o?.build_key === 'string' ? o.build_key : '',
		server_regions: regions.filter(
			(r): r is ServerRegionRoot =>
				!!r &&
				typeof r === 'object' &&
				typeof (r as ServerRegionRoot).iid === 'string' &&
				typeof (r as ServerRegionRoot).abs === 'string'
		)
	};
}

/** The server leg's handoff under `out_dir`, or null when there is none (a standalone or
 *  client-only build). */
export function read_server_handoff(out_dir: string): ServerHandoff | null {
	try {
		return parse_server_handoff(fs.readFileSync(server_handoff_path(out_dir), 'utf8'));
	} catch {
		return null; // ok: no server leg ran before this one (or it died mid-write: emit everything)
	}
}

/**
 * Should an island whose host module is `host_path` get a client chunk? `loaded` is the server
 * leg's transformed-module set (`host_key`-normalised), or `null` when there is no handoff.
 * An island with no recorded host (a library island registered through a bridge) is always emitted.
 *
 * The prescan registers every marked import under `src/`, but a host nothing imports (a second
 * route tree, a retired component) is no island the app serves, and its imports would enter a
 * client build whose server pass never analysed them (a `.remote.ts` there fails Kit's remote
 * metadata check). Kit builds the server bundle first; its transform pass is the ground truth for
 * reachability.
 */
export function island_host_loaded(
	host_path: string | null | undefined,
	loaded: Set<string> | null | undefined
): boolean {
	if (!loaded) return true;
	if (!host_path) return true;
	return loaded.has(host_key(host_path));
}
