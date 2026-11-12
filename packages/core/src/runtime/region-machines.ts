/**
 * THE REGION ELEMENT'S LIFECYCLES, as machines (`@ogygia/machine`), in place of the flags the
 * element kept beside each other (core.ts `OgygiaRegion`), as they run side by side:
 *
 *   hole    idle ─ armed ─ fetching ─ idle            a deferred region's own fetch of its answer
 *                     ↖ retrying ↙   ╲ failed | offline (asks again online)
 *   answer  none ─ answered ⇄ kept                    what is on screen from the hole's answers
 *   wake    cold ─ armed ─ waking ─ awake | failed    an island's hydration
 *                              ╲ offline ─ armed      (its code failed offline: wakes online)
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
import { machine, type Machine, type MachineGraph } from '@ogygia/machine';
import type { IslandHandle } from './hydrate-core.ts';

type HoleStates = {
	/** Not asked yet, or its fetch ended (answered, or torn down). */
	idle: {};
	/** Its `when` (and `prefetch`) schedule is armed. `attempts`: the fetches that failed before. */
	armed: { attempts: number };
	/** Its own fetch is in flight. `revalidate`: past the browser cache (a refresh). */
	fetching: { attempts: number; revalidate: boolean };
	/** A fetch failed, and it waits to try again. */
	retrying: { attempts: number; revalidate: boolean };
	/** A fetch failed for the network while the browser is offline: it asks again, with fresh tries,
	 *  once the browser is back online (#891). */
	offline: { revalidate: boolean };
	/** It gave up: refused, or out of tries. The fallback (or the answer before) stands. */
	failed: {};
};

const hole_steps = {
	idle: ['armed', 'fetching'],
	armed: ['idle', 'fetching'],
	fetching: ['idle', 'retrying', 'offline', 'failed'],
	retrying: ['idle', 'armed', 'fetching', 'failed'],
	offline: ['idle', 'armed', 'fetching'],
	failed: ['idle', 'armed', 'fetching']
} as const;

const hole_definition = machine<HoleStates>()({
	name: 'hole',
	initial: 'idle',
	steps: hole_steps
});

export type Hole = Machine<HoleStates, typeof hole_steps>;

/** A hole's fetch machine, idle. */
export function create_hole(): Hole {
	return hole_definition.create();
}

type AnswerStates = {
	/** Nothing from the hole is on screen: its fallback. */
	none: {};
	/** An answer is swapped in. */
	answered: {};
	/** It answered `keepFallback()`: the fallback stands as its answer. */
	kept: {};
};

// (each answer is a visit of its own, a second one too: the trace sees every answer on screen)
const answer_steps = {
	none: ['answered', 'kept'],
	answered: ['answered', 'kept'],
	kept: ['answered', 'kept']
} as const;

const answer_definition = machine<AnswerStates>()({
	name: 'hole-answer',
	initial: 'none',
	steps: answer_steps
});

export type Answer = Machine<AnswerStates, typeof answer_steps>;

/** A hole's answer machine: nothing on screen yet. */
export function create_answer(): Answer {
	return answer_definition.create();
}

type WakeStates = {
	/** Asleep, nothing armed. */
	cold: {};
	/** Its schedule (and the capture of early input) is armed. */
	armed: {};
	/** Its module and the hydrate core load; then its hydrate step. */
	waking: {};
	/** Hydrated: the island is live. */
	awake: {};
	/** Its code failed to download while the browser is offline: it wakes again once the browser is
	 *  back online (#891). Its server markup stays meanwhile. `error`: the failed download. */
	offline: { error: unknown };
	/** Hydrating threw: its server markup stays as it is. */
	failed: { error: unknown };
};

const wake_steps = {
	cold: ['armed', 'waking'],
	armed: ['cold', 'waking'],
	waking: ['cold', 'awake', 'offline', 'failed'],
	awake: ['cold'],
	offline: ['cold', 'armed'],
	failed: ['cold']
} as const;

const wake_definition = machine<WakeStates>()({
	name: 'wake',
	initial: 'cold',
	steps: wake_steps
});

export type Wake = Machine<WakeStates, typeof wake_steps>;

/** The wake machine's states and steps, as data (internal/notes/flows/region-wake.md draws it). */
export function wake_graph(): MachineGraph {
	return wake_definition.graph();
}

/** An island's wake machine, cold. */
export function create_wake(): Wake {
	return wake_definition.create();
}

type LiveStates = {
	/** No tick yet, or its island could not hydrate (the next tick starts over). */
	idle: {};
	/** A static region: the frame store's frames morph into it (it is subscribed while here). */
	static: {};
	/** An interactive tick's HTML is in; its island loads and hydrates. */
	hydrating: { module: string };
	/** Its island is live: a tick of the same module pushes props. Leaving disposes it. */
	live: { module: string; app: IslandHandle };
	/** Its island's file could not load (said once, coded): a tick of the same module shows its HTML
	 *  and loads nothing; another module, or a static tick, starts afresh (#942). */
	failed: { module: string; error: unknown };
};

const live_steps = {
	idle: ['static', 'hydrating'],
	static: ['idle', 'hydrating'],
	hydrating: ['idle', 'static', 'hydrating', 'live', 'failed'],
	live: ['idle', 'static', 'hydrating'],
	failed: ['idle', 'static', 'hydrating']
} as const;

const live_definition = machine<LiveStates>()({
	name: 'live-region',
	initial: 'idle',
	steps: live_steps
});

export type Live = Machine<LiveStates, typeof live_steps>;

/** A live region's machine, before its first tick. */
export function create_live(): Live {
	return live_definition.create();
}

type PaintStates = {
	/** No frame is waiting to paint. */
	idle: {};
	/** A frame waits for its stylesheets, then paints. A newer frame is a new visit: the older one's
	 *  wait ends with nothing painted. */
	painting: {};
};

const paint_steps = {
	idle: ['painting'],
	painting: ['painting', 'idle']
} as const;

const paint_definition = machine<PaintStates>()({
	name: 'region-paint',
	initial: 'idle',
	steps: paint_steps
});

export type Paint = Machine<PaintStates, typeof paint_steps>;

/** A region's paint machine: which frame (a hole's answer, a static live tick) paints next. */
export function create_paint(): Paint {
	return paint_definition.create();
}
