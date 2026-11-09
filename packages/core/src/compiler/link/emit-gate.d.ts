export declare const SSR_HOSTS_HANDOFF = "og-ssr-hosts.json";
/** `<outDir>/og-ssr-hosts.json` — written by the server leg, read by the client leg. */
export declare function ssr_hosts_handoff_path(out_dir: string): string;
/**
 * Should an island whose host module is `host_path` get a client chunk? `loaded` is the server
 * leg's transformed-module set (`host_key`-normalised), or `null` when there is no handoff.
 * An island with no recorded host (a library island registered through a bridge) is always emitted.
 */
export declare function island_host_loaded(host_path: string | null | undefined, loaded: Set<string> | null | undefined): boolean;
/** Parse the handoff file's contents into the set `island_host_loaded` consumes. */
export declare function parse_ssr_hosts(json: string): Set<string>;
