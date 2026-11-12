import {
	machine,
	mailbox,
	scope,
	type Mailbox,
	type Machine,
	type MachineGraph,
	type Scope
} from '@ogygia/machine';
import type { IslandHandle } from './hydrate-core.ts';

/** What a region element holds for one lifetime in the page: the scope everything it holds across
 *  its machines' visits is given to, and the mailbox its events take turns in (open while it is). */
type Lifetime = { life: Scope; box: Mailbox };

type RegionStates = {
	detached: Lifetime;
	connected: Lifetime;
	scheduled: Lifetime;
};

const region_steps = {
	detached: ['connected'],
	connected: ['scheduled', 'detached'],
	scheduled: ['connected', 'detached']
} as const;

const region_definition = machine<RegionStates>()({
	name: 'region-life',
	initial: 'detached',
	steps: region_steps
});

const NOT_CONNECTED = scope();
NOT_CONNECTED.close();
/** A region out of the page holds nothing: anything given to its lifetime is let go at once, every
 *  post to its mailbox is dropped and every wait in it is `STALE`. */
const DETACHED: Lifetime = { life: NOT_CONNECTED, box: mailbox(NOT_CONNECTED) };

/**
 * A region element's lifetime in the page (core.ts). `detached`: before its first connect, and
 * after it left the page (its lifetime closed). `connected`: in the page, a lifetime of its own (a
 * move, out and back in one task, is no removal: it keeps it). `scheduled`: its connect armed its
 * schedule (or found its answer), so a connect again stops there; a fetch that failed goes back to
 * `connected` for its retry to connect afresh.
 */
export type RegionLife = Machine<RegionStates, typeof region_steps>;

/** The region life machine as data. */
export function region_life_graph(): MachineGraph {
	return region_definition.graph();
}

/** A region element's life machine, detached. */
export function create_region_life(): RegionLife {
	return region_definition.create(DETACHED);
}

/** A new lifetime in the page: its scope and its mailbox. */
export function new_lifetime(): Lifetime {
	const life = scope();
	return { life, box: mailbox(life) };
}

/** The lifetime ended: what `detached` holds. */
export function detached(): Lifetime {
	return DETACHED;
}

/** The lifetime a state holds, as data for the next one (a state's value carries its `kind`). */
export function lifetime_of(now: Lifetime): Lifetime {
	return { life: now.life, box: now.box };
}

type HoleStates = {
	idle: {};
	armed: { attempts: number };
	fetching: { attempts: number; revalidate: boolean };
	retrying: { attempts: number; revalidate: boolean };
	offline: { revalidate: boolean };
	failed: {};
};

const hole_steps = {
	idle: ['armed', 'fetching'],
	armed: ['idle', 'fetching'],
	fetching: ['idle', 'retrying', 'offline', 'failed'],
	retrying: ['idle', 'armed', 'fetching'],
	offline: ['idle', 'armed', 'fetching'],
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
 * waits to try again. `offline`: a fetch failed for the network while the browser is offline; it
 * asks again, with fresh tries, once the browser is back online (#891). `failed`: refused, or out of
 * tries; the fallback (or the answer before) stands. `attempts` counts the fetches that failed
 * before.
 */
export type Hole = Machine<HoleStates, typeof hole_steps>;

/** The hole's fetch machine as data (internal/notes/flows/holes.md draws it). */
export function hole_graph(): MachineGraph {
	return hole_definition.graph();
}

/** A hole's fetch machine, idle. */
export function create_hole(): Hole {
	return hole_definition.create();
}

type AnswerStates = {
	none: {};
	answered: {};
	kept: {};
};

// @why each answer is a visit of its own, a second one too, so the trace sees every answer on screen (test: test/browser/hole-lifecycle.test.ts › a hole answered twice moves once per answer, and the second answer is the one on screen)
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

/** What is on screen from a hole's answers. `none`: its fallback. `answered`: an answer is swapped
 *  in. `kept`: it answered `keepFallback()`, so the fallback stands as its answer. */
export type Answer = Machine<AnswerStates, typeof answer_steps>;

/** The hole's answer machine as data (internal/notes/flows/holes.md draws it). */
export function answer_graph(): MachineGraph {
	return answer_definition.graph();
}

/** A hole's answer machine: nothing on screen yet. */
export function create_answer(): Answer {
	return answer_definition.create();
}

type WakeStates = {
	cold: {};
	armed: {};
	waking: {};
	awake: {};
	offline: { error: unknown };
	failed: { error: unknown };
};

const wake_steps = {
	cold: ['armed'],
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

/** An island's hydration. `cold`: asleep, nothing armed. `armed`: its schedule (and the capture of
 *  early input) waits. `waking`: its module and the hydrate core load, then its hydrate step runs.
 *  `awake`: hydrated. `offline`: its code failed to download while the browser is offline; it wakes
 *  again once the browser is back online, its server markup staying meanwhile (`error`: the failed
 *  download, #891). `failed`: hydrating threw; its server markup stays as it is. */
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
	idle: {};
	static: {};
	hydrating: { module: string };
	live: { module: string; app: IslandHandle };
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

/** A live region, driven by `applyLive`. `idle`: no tick yet, or its island could not hydrate (the
 *  next tick starts over). `static`: the frame store's frames morph into it. `hydrating`: an
 *  interactive tick's HTML is in; its island loads and hydrates. `live`: its island is live; a tick
 *  of the same module pushes props, and leaving disposes it. `failed`: its island's file could not
 *  load (said once, coded); a tick of the same module shows its HTML and loads nothing, another
 *  module or a static tick starts afresh (#942). */
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

/** Where a region element's machines are, by machine name. (Its answer has no rest: a region put
 *  back keeps what it showed.) */
export type RegionMachinesNow = {
	hole: Hole['now']['kind'];
	wake: Wake['now']['kind'];
	'live-region': Live['now']['kind'];
	'region-paint': Paint['now']['kind'];
};

/** Where each rests: off the page, a region's machines are here (core.ts `#teardown` puts them
 *  there; the rule `rule_region_left_busy` holds it). */
export const REGION_REST: Readonly<RegionMachinesNow> = {
	hole: 'idle',
	wake: 'cold',
	'live-region': 'idle',
	'region-paint': 'idle'
};

/** The machines in `now` not at rest, each as `name state` (the rule's detail). */
export function busy_machines(now: RegionMachinesNow): string[] {
	const busy: string[] = [];
	for (const name of Object.keys(REGION_REST) as Array<keyof RegionMachinesNow>) {
		if (now[name] !== REGION_REST[name]) busy.push(`${name} ${now[name]}`);
	}
	return busy;
}
