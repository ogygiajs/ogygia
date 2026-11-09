import { type KitDirs } from '../compiler/kit.ts';
/** The plugin list as a Vite config holds it: plugins, arrays of them, promises of either, falsy. */
type PluginOption = unknown;
/** Resolve `{ routes_dir, out_dir }` for `root` from its Kit config (defaults when absent or
 *  unreadable) and cache it for the compiler. `plugins`: the Vite config's plugin list. */
export declare function load_kit_dirs(root: string, plugins?: PluginOption): Promise<KitDirs>;
export {};
