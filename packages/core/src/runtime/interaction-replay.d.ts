/**
 * The interaction wake's SECOND half (see ./interaction.ts): once the island is live, put back
 * what the visitor did while it was waking — typed values, focus, the canceled clicks — at each
 * element's ADDRESS (hydration may have replaced the nodes). Loaded when the first interaction
 * island arms; never part of the boot.
 */
import type { Scope } from '@ogygia/machine';
import type { FieldSnapshot, QueuedClick } from './interaction.ts';
/**
 * Replay the queued clicks in arrival order at each click's address (tag-checked against drift).
 * One frame later: hydration just (re)bound the island's web-component wiring (a dropdown web
 * component's `target` element, set by a reactive statement) and many components apply such
 * changes in their own render tick. A synchronous replay lands before that tick and toggles
 * nothing; after a frame the component is settled. The frame is `owner`'s (the region's lifetime in
 * the page): a region gone by then replays nothing.
 */
export declare function replay_clicks(region: Element, queued: QueuedClick[], owner: Scope): void;
/** The island is live: fields back, focus back, clicks replayed. */
export declare function after_wake(region: Element, fields: FieldSnapshot[], active_addr: number[] | null, queued: QueuedClick[], owner: Scope): void;
