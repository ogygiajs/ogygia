/**
 * WHAT A VISITOR DOES BEFORE AN ISLAND IS LIVE IS NOT LOST. `wake: 'interaction'` — the island sleeps
 * until someone uses it; and every scheduled island (`load` / `idle` / `visible` / media) is armed the
 * same way until it is live, since its server markup has no handlers either: a press on it wakes it at
 * once (a gesture), and the click is replayed when it is live.
 *
 * WAKE (capture-phase): `pointerdown` | `keydown` | `focusin` | `click`. The first of these starts
 * hydration. WARM (not a wake): the pointer moving over the region prefetches the island module, so
 * by the time the press lands the chunk is usually cached and the wake is one microtask.
 *
 * DELEGATED: the listeners live on the DOCUMENT, once — five per armed island used to be five
 * hundred on a page of interaction islands. An event resolves to the nearest ARMED region above its
 * target (`closest`, walking up past nested regions that are not armed) and that region's state
 * handles it exactly as its own capture listener did.
 *
 * HYDRATION REPLACES NODES. Svelte's hydrate pass may recreate the region's DOM, so nothing
 * captured before the wake can be replayed/restored by node reference — the original elements are
 * disconnected afterwards. Everything below is therefore re-resolved POSITIONALLY: an element is
 * recorded as its child-index path from the region ("address"), and after hydration the element
 * now sitting at that address receives the replay/restore. The hydrated markup mirrors the SSR
 * markup (same component, same props), so addresses stay valid; a tag-name check guards drift.
 *
 * WHAT SURVIVES THE WAKE:
 * - **Clicks are queued + replayed.** While waking, `click` events are `preventDefault()`ed and
 *   recorded (address + coordinates); after hydration each re-dispatches at its address. Cancel-
 *   then-replay means a checkbox / link / summary activates exactly ONCE — on the replay, where
 *   the island's handlers exist. Enter/Space activation arrives as a derived click → same path.
 * - **Typing lands natively and is restored.** Characters are in the DOM before hydration starts;
 *   hydration resets `.value` from SSR state, so field values (+ checkedness + selection) are
 *   snapshotted at wake and re-applied at the field's address, with `input`/`change` events so
 *   `bind:` syncs. Keydowns are never synthetically replayed (untrusted keys produce no text).
 * - **Focus is restored** at the focused element's address.
 *
 * Replayed events are NOT trusted user gestures (`event.isTrusted === false`): `window.open`,
 * clipboard, fullscreen from the first interaction will be blocked by the browser, and a component
 * that ignores untrusted clicks ignores the replay. Components can detect the situation via
 * `hydratedBy() === 'interaction'`. A click that opens a link elsewhere (a modifier or the middle
 * button) is never canceled: the browser does it on the server markup, and an untrusted replay could not.
 *
 * The capture (this module) is what must run synchronously inside the first event. The RESTORE +
 * REPLAY half (./interaction-replay.ts) is only needed once an island has woken, so it loads when a
 * pointer reaches an armed island or input lands — off the boot path, ahead of the replay.
 */
import { type Scope } from '@ogygia/machine';
/** Feature entry: fill the `interaction` slot — wake a cold island on first use, warm on hover. */
export declare function install(): void;
/** Child-index path from `region` down to `el` — survives node replacement by position. */
export declare function element_address(region: Element, el: Element): number[] | null;
/** The element now sitting at `addr` under `region` (post-hydration), or null. */
export declare function resolve_address(region: Element, addr: number[]): Element | null;
export type FieldSnapshot = {
    /** The PRE-hydration node. Values are read from it AT RESTORE TIME: the wake fires on the very
     * first keydown — BEFORE that key's character has landed — and more keystrokes land in this
     * node while the island loads. A detached node keeps its `.value`, so at restore it holds
     * everything the user typed up to the moment hydration swapped it out. */
    el: HTMLInputElement;
    addr: number[];
    tag: string;
};
/**
 * Wake the island for a visitor. `replayed` is what replays their input once it is live (the replay
 * half, loading): the island's wake waits for it before it goes live, so the input lands AT wake. An
 * island that went live first left the replay to come in later, over a slow network, beside the
 * visitor's next click (#260). Resolves when the island is live; rejects when it failed to wake.
 */
export type WakeFn = (replayed: Promise<unknown>) => Promise<void> | void;
export type QueuedClick = {
    addr: number[];
    /** The deepest node of the click's composed path when it lies INSIDE a web component's shadow
     *  tree (a design-system button's inner <button>): a host-level replay never reaches the shadow-internal
     *  handler that actually toggles the component, so the replay lands here instead. */
    deep: EventTarget | null;
    tag: string;
    init: MouseEventInit;
};
/**
 * Arm a cold `wake="interaction"` region.
 *
 * @param region the `<ogygia-region>` element
 * @param warm   prefetch the island module (no hydrate) — wired to the pointer entering the region
 * @param fire   begin hydration ({@link WakeFn}); resolves when the island is live
 * @param owner  the region's lifetime in the page: the frame its clicks replay in is its
 * @returns disarm(over?) — end this arming (the island is live or failed, or the region left
 *          before any interaction); `over`: the region left while it was woken, so its queued clicks
 *          are dropped instead of replayed
 */
export declare function arm_interaction(region: Element, warm: () => void, fire: WakeFn, owner: Scope): (over?: boolean) => void;
