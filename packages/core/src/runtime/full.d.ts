import type { ClientPlugin } from '../plugin/client.ts';
/** Boot the kitchen-sink runtime (all boot-phase features) with the plugins' browser halves.
 *  Idempotent via {@link ./core.js boot}. */
export declare function bootDev(client_plugins?: readonly ClientPlugin[]): void;
