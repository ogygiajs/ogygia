/**
 * The plugins' browser halves, as the runtime calls them (`ogygia/plugin/client`). The boot entry
 * hands them over; every call site sits behind the `__OGYGIA_CLIENT_PLUGINS__` gate, so a build with
 * none folds them away.
 */
import type { ClientPlugin } from '../plugin/client.ts';
export declare const CLIENT_PLUGINS: boolean;
/** Boot each plugin's browser half (the runtime's boot, or a Kit-owned page's). */
export declare function boot_client_plugins(list: readonly ClientPlugin[], kit_page: boolean): void;
/** A region's component started in the browser: its entry, and the files it runs from. */
export declare function client_region_mount(el: Element): void;
/** A region's component left the page. */
export declare function client_region_unmount(el: Element, entry: string): void;
