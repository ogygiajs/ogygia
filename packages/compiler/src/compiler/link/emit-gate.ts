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
import fs from 'node:fs';
import path from 'node:path';
import { host_key } from '../program.ts';

export const SERVER_HANDOFF = 'og-server-handoff.json';

/** `<outDir>/og-server-handoff.json`: written by the server leg, read by the client leg. */
export function server_handoff_path(out_dir: string): string {
	return path.join(out_dir, SERVER_HANDOFF);
}

/**
 * What the server leg used, for the client leg, which may be another plugin instance (Kit 2 loads
 * the config once per leg). A file between ogygia's own legs, under Kit's `outDir` beside the server
 * bundle that already holds the key; never shipped. `hosts`: the server bundle's transformed modules
 * (the emit gate). `build_key`: the signing key the server bundle baked, for the client bundle's
 * secret check (link/build-output.ts `refuse_client_secrets`).
 */
export interface ServerHandoff {
	readonly hosts: Set<string>;
	readonly build_key: string;
}

/** The handoff file's text. */
export function server_handoff_json(hosts: readonly string[], build_key: string): string {
	return JSON.stringify({ hosts, build_key });
}

/** The handoff file's contents. A malformed field reads as empty: nothing gated, never a throw. */
export function parse_server_handoff(json: string): ServerHandoff {
	const o = JSON.parse(json) as { hosts?: unknown; build_key?: unknown } | null;
	const hosts = Array.isArray(o?.hosts) ? o.hosts.filter((x) => typeof x === 'string') : [];
	return {
		hosts: new Set(hosts),
		build_key: typeof o?.build_key === 'string' ? o.build_key : ''
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
 */
export function island_host_loaded(
	host_path: string | null | undefined,
	loaded: Set<string> | null | undefined
): boolean {
	if (!loaded) return true;
	if (!host_path) return true;
	return loaded.has(host_key(host_path));
}
