import { decisions, type Decisions } from '@ogygia/machine';
import type { RegionValue } from './region.ts';

/** What a region is, from its settings (`__og.mode`) or the value it holds (`of`). */
export type RegionKind = (typeof REGION_INPUTS.kind)[number];

/** Every fact Region reads before it renders, each a short list of values. */
export const REGION_INPUTS = {
	kind: [
		'island',
		'hole',
		'lake',
		'inline',
		'dual',
		'dual-island',
		'deferred',
		'live',
		'live-baked',
		'promise',
		'promise-bare',
		'nothing'
	],
	in_island: [false, true],
	live_snippet: [false, true],
	in_lake: [false, true],
	pass_mark: [false, true],
	request: ['none', 'no-event', 'event'],
	csr_doc: [false, true],
	server: [false, true],
	module: [false, true],
	wakes: [false, true]
} as const;

/** One region's inputs. */
export type RegionInputs = {
	-readonly [K in keyof typeof REGION_INPUTS]: (typeof REGION_INPUTS)[K][number];
};

/** What a region renders in its place. */
export type RegionArm =
	| 'island-inline'
	| 'island-shell'
	| 'hole-frozen'
	| 'hole-adopt'
	| 'hole-shell'
	| 'lake-adopt'
	| 'lake-children'
	| 'inline'
	| 'dual'
	| 'live-baked'
	| 'live'
	| 'deferred'
	| 'promise'
	| 'nothing';

/** Everything Region does for one input, as plain data. */
export interface RegionPlan {
	family: 'island' | 'hole' | 'lake' | 'held';
	arm: RegionArm;
	nested: boolean;
	inline: boolean;
	csr: boolean;
	root: 'none' | 'kit' | 'ogygia';
	mark_pass: boolean;
	reset_event: boolean;
	set_nested: 'none' | 'island' | 'plain';
	hole_inline: boolean;
	leave_live_snippet: boolean;
	contexts: boolean;
	tail: boolean;
	seed: 'none' | 'island' | 'hole' | 'promise' | 'held';
	runtime: boolean;
	head: 'none' | 'island' | 'hole' | 'held';
	kit_meta: boolean;
	island_css: boolean;
	hole_css: boolean;
	wire: 'none' | 'island' | 'hole';
	island_graph: boolean;
	hole_graph: boolean;
	hole_tail: boolean;
	note_hole: boolean;
	early_hole: boolean;
	devtools: 'none' | 'island' | 'hole' | 'lake';
	warn: 'none' | 'hole-inline' | 'island-parent' | 'promise';
	lake_inside: boolean;
	late_load: boolean;
}

const ISLANDS: ReadonlySet<RegionKind> = new Set(['island', 'dual-island']);
const HELD_LIVE: ReadonlySet<RegionKind> = new Set([
	'deferred',
	'live',
	'live-baked',
	'promise',
	'promise-bare'
]);
const HELD_ARMS: Readonly<Record<string, RegionArm>> = {
	inline: 'inline',
	dual: 'dual',
	deferred: 'deferred',
	live: 'live',
	'live-baked': 'live-baked',
	promise: 'promise',
	'promise-bare': 'promise',
	nothing: 'nothing'
};

function family_of(kind: RegionKind): RegionPlan['family'] {
	if (ISLANDS.has(kind)) return 'island';
	if (kind === 'hole' || kind === 'lake') return kind;
	return 'held';
}

/** What a region is: its settings' mode for a placed one, else the value it holds, as it is now. */
export function region_kind(
	mode: 'island' | 'server' | 'lake' | undefined,
	of: RegionValue | undefined,
	of_is_promise: boolean,
	baked: boolean,
	waiting_ui: boolean
): RegionKind {
	if (mode === 'island') return 'island';
	if (mode === 'server') return 'hole';
	if (mode === 'lake') return 'lake';
	if (of_is_promise) return waiting_ui ? 'promise' : 'promise-bare';
	if (!of) return 'nothing';
	if (of.kind === 'inline') return 'inline';
	if (of.kind === 'dual') return of.hydrate ? 'dual-island' : 'dual';
	if (of.html == null) return 'deferred';
	return baked ? 'live-baked' : 'live';
}

/** What Kit's request context above a region holds: nothing, a page pass with no event yet, or an event. */
export function request_state(req: { event?: unknown } | undefined): RegionInputs['request'] {
	if (!req) return 'none';
	return req.event == null ? 'no-event' : 'event';
}

function root_of(i: RegionInputs): RegionPlan['root'] {
	if (!i.server) return 'none';
	if (i.pass_mark || i.request === 'no-event') return 'kit';
	return i.request === 'event' ? 'ogygia' : 'none';
}

function arm_of(i: RegionInputs, nested: boolean, csr: boolean): RegionArm {
	if (ISLANDS.has(i.kind)) return nested || csr ? 'island-inline' : 'island-shell';
	if (i.kind === 'hole') {
		if (nested) return 'hole-frozen';
		return i.live_snippet || csr ? 'hole-adopt' : 'hole-shell';
	}
	if (i.kind === 'lake') return csr || nested ? 'lake-adopt' : 'lake-children';
	return HELD_ARMS[i.kind]!;
}

function seed_of(i: RegionInputs, nested: boolean): RegionPlan['seed'] {
	if (!i.server || nested) return 'none';
	if (ISLANDS.has(i.kind)) return 'island';
	if (i.kind === 'hole') return i.wakes ? 'hole' : 'none';
	if (i.kind === 'promise' || i.kind === 'promise-bare') return 'promise';
	return HELD_LIVE.has(i.kind) ? 'held' : 'none';
}

function head_of(i: RegionInputs): RegionPlan['head'] {
	if (!i.server) return 'none';
	if (ISLANDS.has(i.kind)) return 'island';
	return i.kind === 'hole' ? 'hole' : 'held';
}

function devtools_of(i: RegionInputs, nested: boolean, inline: boolean): RegionPlan['devtools'] {
	if (!i.server) return 'none';
	if (ISLANDS.has(i.kind)) return inline ? 'none' : 'island';
	if (i.kind === 'hole') return nested ? 'none' : 'hole';
	return i.kind === 'lake' && nested ? 'lake' : 'none';
}

function warn_of(i: RegionInputs, nested: boolean): RegionPlan['warn'] {
	if (nested && i.kind === 'hole') return 'hole-inline';
	if (nested && ISLANDS.has(i.kind)) return 'island-parent';
	return i.kind === 'promise-bare' ? 'promise' : 'none';
}

function decide(i: RegionInputs): RegionPlan {
	const island = ISLANDS.has(i.kind);
	const hole = i.kind === 'hole';
	const nested = i.in_island && !(hole && i.live_snippet);
	const root = root_of(i);
	const tail = root === 'kit';
	const csr = i.csr_doc && !i.in_lake && root !== 'ogygia';
	const inline = nested || csr;
	let set_nested: RegionPlan['set_nested'] = 'none';
	if (!nested && island) set_nested = 'island';
	else if (!nested && hole) set_nested = 'plain';
	let wire: RegionPlan['wire'] = 'none';
	if (island && !inline) wire = 'island';
	else if (hole && !nested && i.wakes) wire = 'hole';
	return {
		family: family_of(i.kind),
		arm: arm_of(i, nested, csr),
		nested,
		inline,
		csr,
		root,
		mark_pass: tail && !i.pass_mark,
		reset_event: i.server && i.request === 'no-event',
		set_nested,
		hole_inline: hole && nested,
		leave_live_snippet: island && nested && i.live_snippet,
		contexts: !i.server && hole,
		tail,
		seed: seed_of(i, nested),
		runtime: !nested && ((island && !csr) || hole || HELD_LIVE.has(i.kind)),
		head: head_of(i),
		kit_meta: i.server && island && inline,
		island_css: i.server && i.kind === 'island',
		hole_css: i.server && hole && nested,
		wire,
		island_graph: island && !nested,
		hole_graph: hole && !nested && i.module && i.wakes,
		hole_tail: tail && hole && !nested && (csr || i.live_snippet),
		note_hole: tail && hole && !nested,
		early_hole: i.server && hole && !nested,
		devtools: devtools_of(i, nested, inline),
		warn: warn_of(i, nested),
		lake_inside: i.kind === 'lake' && nested,
		late_load: !i.server && island && inline
	};
}

function refuse(i: RegionInputs): string | null {
	if (!i.server && (i.pass_mark || i.request !== 'none')) return 'no Kit request in the browser';
	if (i.module && i.kind !== 'hole') return 'a module on a region that is not a hole';
	return null;
}

/** Region's decision table: the plan for every input it can be given. */
export const REGION: Decisions<RegionInputs, RegionPlan> = decisions<RegionInputs, RegionPlan>({
	name: 'region',
	inputs: REGION_INPUTS as unknown as { [K in keyof RegionInputs]: readonly RegionInputs[K][] },
	refuse,
	decide
});
