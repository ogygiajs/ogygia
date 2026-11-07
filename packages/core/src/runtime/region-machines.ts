/**
 * THE REGION ELEMENT'S LIFECYCLES, as machines (`@ogygia/machine`), in place of the flags the
 * element kept beside each other (core.ts `OgygiaRegion`), as they run side by side:
 *
 *   hole    idle ─ armed ─ fetching ─ idle            a deferred region's own fetch of its answer
 *                     ↖ retrying ↙   ╲ failed
 *   answer  none ─ answered ⇄ kept                    what is on screen from the hole's answers
 *   wake    cold ─ armed ─ waking ─ awake | failed    an island's hydration
 *
 * - The hole's fetch and its answer are two machines because they are independent: an answer can land
 *   while the hole waits to retry, or comes from a twin, a batch or a write at its address; the
 *   hole's own fetch then ends (a retry it waited for is called off) and the answer stands.
 * - A schedule (`when`, `prefetch`, a wake's `wake`) arms its listener with `onLeave` on the state that
 *   armed it, so leaving `armed` drops every one of them: two schedules on one region, or one armed
 *   again, can no longer overwrite each other's slot and leak the first.
 * - A visit is its own object: code that awaited checks `machine.now === mine` to know it still is
 *   the visit it started in.
 */
import { machine, type Machine } from '@ogygia/machine';

type HoleStates = {
	/** Not asked yet, or its fetch ended (answered, or torn down). */
	idle: {};
	/** Its `when` (and `prefetch`) schedule is armed. `attempts`: the fetches that failed before. */
	armed: { attempts: number };
	/** Its own fetch is in flight. `revalidate`: past the browser cache (a refresh). */
	fetching: { attempts: number; revalidate: boolean };
	/** A fetch failed, and it waits to try again. */
	retrying: { attempts: number; revalidate: boolean };
	/** It gave up: refused, or out of tries. The fallback (or the answer before) stands. */
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
	/** Hydrating threw: its server markup stays as it is. */
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

export type Wake = Machine<WakeStates, typeof wake_steps>;

/** An island's wake machine, cold. */
export function create_wake(): Wake {
	return wake_definition.create();
}
