/**
 * Live-region feature: the pushable props a live `<Region>` and a kept island hydrate with, so later
 * `query.live` ticks (and the next page's props) reach the mounted island in place instead of
 * re-hydrating it.
 *
 * A HYDRATE-phase feature (link/runtime-entry.ts): installed by the hydrate core, never the boot.
 */
import { slots } from './slots.ts';
import { pushable_props } from './pushable-props.svelte.ts';

/** Feature entry: fill the `pushable` slot with {@link pushable_props}. */
export function install(): void {
	slots.pushable = pushable_props;
}
