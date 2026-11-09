import type { Plugin } from 'vite';
/** where the client build's maps are kept, off the served output: `<kit outDir>/ogygia-client-maps` */
export declare const CLIENT_MAPS_DIR = "ogygia-client-maps";
/** `<kit outDir>/output/client` → `<kit outDir>/ogygia-client-maps` */
export declare function client_maps_stash(client_dir: string): string;
/** `measuring()`: a plugin asked for the build's measurement data (read when the config resolves,
 *  after ogygia's own `config` ran the plugins' build hooks). */
export declare function server_sourcemaps_plugin(measuring: () => boolean): Plugin;
