/**
 * `context` feature — the cross-island context bridge.
 *
 * Fills {@link ./slots.js slots.context} with the DOM walk that seeds each island's `getContext`
 * from a `<Provide>` / drop-in-`setContext` marker above it (see `../context-bridge.js`). Included
 * only when the build finds an app file that reaches an ogygia context provider — `Provide`,
 * `setContext`, or `createContext`, in any import form (the compiler's link/own-reach.ts). A plain
 * app that never bridges context tree-shakes the ~4.7 kB bridge away; core reads the slot with
 * optional chaining, so its absence is just "no provider above" — the common, already-handled case.
 *
 * A HYDRATE-phase feature (link/runtime-entry.ts): installed by the hydrate core, never the boot.
 */
import { collect_provided_context } from '../context-bridge.ts';
import { slots } from './slots.ts';

export function install(): void {
	slots.context = collect_provided_context;
}
