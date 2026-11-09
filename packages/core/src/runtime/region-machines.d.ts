/**
 * THE REGION ELEMENT'S LIFECYCLES, as machines (`@ogygia/machine`), in place of the flags the
 * element kept beside each other (core.ts `OgygiaRegion`), as they run side by side:
 *
 *   hole    idle ─ armed ─ fetching ─ idle            a deferred region's own fetch of its answer
 *                     ↖ retrying ↙   ╲ failed
 *   answer  none ─ answered ⇄ kept                    what is on screen from the hole's answers
 *   wake    cold ─ armed ─ waking ─ awake | failed    an island's hydration
 *   live    idle ─ static | hydrating ─ live          a live region, driven by `applyLive`
 *   paint   idle ─ painting ⟲                         the frame waiting for its sheets to paint
 *
 * - The hole's fetch and its answer are two machines because they are independent: an answer can land
 *   while the hole waits to retry, or comes from a twin, a batch or a write at its address; the
 *   hole's own fetch then ends (a retry it waited for is called off) and the answer stands.
 * - A schedule (`when`, `prefetch`, a wake's `wake`) arms its listener with `onLeave` on the state that
 *   armed it, so leaving `armed` drops every one of them: two schedules on one region, or one armed
 *   again, can no longer overwrite each other's slot and leak the first.
 * - Every frame that lands (a hole's answer or refresh, a static live tick) waits for its stylesheets
 *   before it paints, and sheets settle in any order: each frame is a visit of `paint`, so only the
 *   newest one paints once its wait is over, and an older one never paints over it.
 * - A visit is its own object: code that awaited checks `machine.now === mine` to know it still is
 *   the visit it started in.
 */
import { type Machine } from '@ogygia/machine';
import type { IslandHandle } from './hydrate-core.ts';
type HoleStates = {
    /** Not asked yet, or its fetch ended (answered, or torn down). */
    idle: {};
    /** Its `when` (and `prefetch`) schedule is armed. `attempts`: the fetches that failed before. */
    armed: {
        attempts: number;
    };
    /** Its own fetch is in flight. `revalidate`: past the browser cache (a refresh). */
    fetching: {
        attempts: number;
        revalidate: boolean;
    };
    /** A fetch failed, and it waits to try again. */
    retrying: {
        attempts: number;
        revalidate: boolean;
    };
    /** It gave up: refused, or out of tries. The fallback (or the answer before) stands. */
    failed: {};
};
declare const hole_steps: {
    readonly idle: readonly ['armed', 'fetching'];
    readonly armed: readonly ['idle', 'fetching'];
    readonly fetching: readonly ['idle', 'retrying', 'failed'];
    readonly retrying: readonly ['idle', 'armed', 'fetching', 'failed'];
    readonly failed: readonly ['idle', 'armed', 'fetching'];
};
export type Hole = Machine<HoleStates, typeof hole_steps>;
/** A hole's fetch machine, idle. */
export declare function create_hole(): Hole;
type AnswerStates = {
    /** Nothing from the hole is on screen: its fallback. */
    none: {};
    /** An answer is swapped in. */
    answered: {};
    /** It answered `keepFallback()`: the fallback stands as its answer. */
    kept: {};
};
declare const answer_steps: {
    readonly none: readonly ['answered', 'kept'];
    readonly answered: readonly ['kept'];
    readonly kept: readonly ['answered'];
};
export type Answer = Machine<AnswerStates, typeof answer_steps>;
/** A hole's answer machine: nothing on screen yet. */
export declare function create_answer(): Answer;
type WakeStates = {
    /** Asleep, nothing armed. */
    cold: {};
    /** Its schedule (and the capture of early input) is armed. */
    armed: {};
    /** Its module and the hydrate core load; then its hydrate step. */
    waking: {};
    /** Hydrated: the island is live. */
    awake: {};
    /** Hydrating threw: its server markup stays as it is. */
    failed: {
        error: unknown;
    };
};
declare const wake_steps: {
    readonly cold: readonly ['armed', 'waking'];
    readonly armed: readonly ['cold', 'waking'];
    readonly waking: readonly ['cold', 'awake', 'failed'];
    readonly awake: readonly ['cold'];
    readonly failed: readonly ['cold'];
};
export type Wake = Machine<WakeStates, typeof wake_steps>;
/** An island's wake machine, cold. */
export declare function create_wake(): Wake;
type LiveStates = {
    /** No tick yet, or its island could not hydrate (the next tick starts over). */
    idle: {};
    /** A static region: the frame store's frames morph into it (it is subscribed while here). */
    static: {};
    /** An interactive tick's HTML is in; its island loads and hydrates. */
    hydrating: {
        module: string;
    };
    /** Its island is live: a tick of the same module pushes props. Leaving disposes it. */
    live: {
        module: string;
        app: IslandHandle;
    };
};
declare const live_steps: {
    readonly idle: readonly ['static', 'hydrating'];
    readonly static: readonly ['idle', 'hydrating'];
    readonly hydrating: readonly ['idle', 'static', 'hydrating', 'live'];
    readonly live: readonly ['idle', 'static', 'hydrating'];
};
export type Live = Machine<LiveStates, typeof live_steps>;
/** A live region's machine, before its first tick. */
export declare function create_live(): Live;
type PaintStates = {
    /** No frame is waiting to paint. */
    idle: {};
    /** A frame waits for its stylesheets, then paints. A newer frame is a new visit: the older one's
     *  wait ends with nothing painted. */
    painting: {};
};
declare const paint_steps: {
    readonly idle: readonly ['painting'];
    readonly painting: readonly ['painting', 'idle'];
};
export type Paint = Machine<PaintStates, typeof paint_steps>;
/** A region's paint machine: which frame (a hole's answer, a static live tick) paints next. */
export declare function create_paint(): Paint;
export {};
