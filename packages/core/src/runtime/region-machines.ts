import { machine, type Machine } from '@ogygia/machine';
import type { IslandHandle } from './hydrate-core.ts';

type HoleStates = {
	idle: {};
	armed: { attempts: number };
	fetching: { attempts: number; revalidate: boolean };
	retrying: { attempts: number; revalidate: boolean };
	failed: {};
};

const hole_steps = {
	idle: ['armed', 'fetching'],
	armed: ['idle', 'fetching'],
	fetching: ['idle', 'retrying', 'failed'],
	retrying: ['idle', 'armed', 'fetching', 'failed'],
	failed: ['idle', 'armed', 'fetching']
} as const;

const hole_definition = machine<HoleStates>()({
	name: 'hole',
	initial: 'idle',
	steps: hole_steps
});

/**
 * A deferred region's own fetch of its answer (the region element, core.ts, runs it beside
 * {@link Answer}). `idle`: not asked yet, or its fetch ended. `armed`: its `when` (and `prefetch`)
 * schedule waits; every listener a schedule arms ends when the hole leaves `armed`. `fetching`: its
 * own fetch is in flight (`revalidate`: past the browser cache). `retrying`: a fetch failed and it
 * waits to try again. `failed`: refused, or out of tries; the fallback (or the answer before)
 * stands. `attempts` counts the fetches that failed before.
 */
export type Hole = Machine<HoleStates, typeof hole_steps>;

/** A hole's fetch machine, idle. */
export function create_hole(): Hole {
	return hole_definition.create();
}

type AnswerStates = {
	none: {};
	answered: {};
	kept: {};
};

const answer_steps = {
	none: ['answered', 'kept'],
	answered: ['kept'],
	kept: ['answered']
} as const;

const answer_definition = machine<AnswerStates>()({
	name: 'hole-answer',
	initial: 'none',
	steps: answer_steps
});

/** What is on screen from a hole's answers. `none`: its fallback. `answered`: an answer is swapped
 *  in. `kept`: it answered `keepFallback()`, so the fallback stands as its answer. */
export type Answer = Machine<AnswerStates, typeof answer_steps>;

/** A hole's answer machine: nothing on screen yet. */
export function create_answer(): Answer {
	return answer_definition.create();
}

type WakeStates = {
	cold: {};
	armed: {};
	waking: {};
	awake: {};
	failed: { error: unknown };
};

const wake_steps = {
	cold: ['armed', 'waking'],
	armed: ['cold', 'waking'],
	waking: ['cold', 'awake', 'failed'],
	awake: ['cold'],
	failed: ['cold']
} as const;

const wake_definition = machine<WakeStates>()({
	name: 'wake',
	initial: 'cold',
	steps: wake_steps
});

/** An island's hydration. `cold`: asleep, nothing armed. `armed`: its schedule (and the capture of
 *  early input) waits. `waking`: its module and the hydrate core load, then its hydrate step runs.
 *  `awake`: hydrated. `failed`: hydrating threw; its server markup stays as it is. */
export type Wake = Machine<WakeStates, typeof wake_steps>;

/** An island's wake machine, cold. */
export function create_wake(): Wake {
	return wake_definition.create();
}

type LiveStates = {
	idle: {};
	static: {};
	hydrating: { module: string };
	live: { module: string; app: IslandHandle };
};

const live_steps = {
	idle: ['static', 'hydrating'],
	static: ['idle', 'hydrating'],
	hydrating: ['idle', 'static', 'hydrating', 'live'],
	live: ['idle', 'static', 'hydrating']
} as const;

const live_definition = machine<LiveStates>()({
	name: 'live-region',
	initial: 'idle',
	steps: live_steps
});

/** A live region, driven by `applyLive`. `idle`: no tick yet, or its island could not hydrate (the
 *  next tick starts over). `static`: the frame store's frames morph into it. `hydrating`: an
 *  interactive tick's HTML is in; its island loads and hydrates. `live`: its island is live; a tick
 *  of the same module pushes props, and leaving disposes it. */
export type Live = Machine<LiveStates, typeof live_steps>;

/** A live region's machine, before its first tick. */
export function create_live(): Live {
	return live_definition.create();
}

type PaintStates = {
	idle: {};
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

/** Which frame (a hole's answer or refresh, a static live tick) paints next. `idle`: no frame is
 *  waiting. `painting`: a frame waits for its stylesheets, then paints. Each frame is a new visit,
 *  so an older frame whose sheets settle later never paints over a newer one. */
export type Paint = Machine<PaintStates, typeof paint_steps>;

/** A region's paint machine: which frame (a hole's answer, a static live tick) paints next. */
export function create_paint(): Paint {
	return paint_definition.create();
}
