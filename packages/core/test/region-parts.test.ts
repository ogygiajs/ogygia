import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import RunInComponent from './_fixtures/RunInComponent.svelte';
import KitPagePass from './_fixtures/KitPagePass.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import { DocumentTail, set_tail_reader } from '../src/server/document-tail.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import {
	set_island_css,
	set_island_deps,
	set_island_remotes,
	set_page_keys,
	set_reads_page
} from './_stubs/server.region-deps.ts';
import { set_region_endpoints } from './_stubs/server.region-endpoint.ts';
import { kit_asset } from '../src/kit-paths.ts';
import { region, type RegionValue } from '../src/region.ts';
import { REGION, type RegionSettings } from '../src/region-plan.ts';
import { RegionPlan } from '../src/region-parts/plan.svelte.ts';
import { IslandWire } from '../src/region-parts/island-wire.svelte.ts';
import { IslandGraph } from '../src/region-parts/island-graph.svelte.ts';
import { HoleFacts } from '../src/region-parts/hole-facts.svelte.ts';
import { RegionHead } from '../src/region-parts/head.svelte.ts';
import { PageSeedAsk } from '../src/region-parts/seed-ask.ts';

type Run = (renderer: unknown, props: { run: () => void }) => void;
const run_in = RunInComponent as unknown as Run;
const kit_pass = KitPagePass as unknown as Component<Record<string, unknown>>;
const ISLAND = '/islands/tiny.js';
const ISLAND_SETTINGS: RegionSettings = {
	mode: 'island',
	entry: ISLAND,
	component: Tiny as unknown as Component
};

function inside(run: () => void, on_kit_pass = false): DocumentTail | null {
	if (!on_kit_pass) {
		void render(RunInComponent as unknown as Component<{ run: () => void }>, { props: { run } })
			.body;
		return null;
	}
	const tail = new DocumentTail();
	const event = { route: { id: '/parts' } };
	set_tail_reader(() => tail);
	set_request_event_stub(() => event);
	try {
		const children = (renderer: unknown) => run_in(renderer, { run });
		void render(kit_pass, { props: { children } }).body;
		return tail;
	} finally {
		set_tail_reader(null);
		set_request_event_stub(null);
	}
}

function plan_of(
	settings: RegionSettings,
	of?: RegionValue | Promise<RegionValue>,
	baked = false
): RegionPlan {
	return new RegionPlan(
		settings,
		() => of,
		() => baked,
		false,
		() => 'load'
	);
}

afterEach(() => {
	set_island_deps({});
	set_island_css({});
	set_island_remotes(null);
	set_reads_page(false);
	set_page_keys(null);
});

describe('RegionPlan', () => {
	it("a placed region's kind is its mode, its plan the table's row for its inputs, and it holds no value", () => {
		let rp!: RegionPlan;
		inside(() => (rp = plan_of(ISLAND_SETTINGS, region(Tiny as never, {}) as never)));
		expect(rp.inputs.kind).toBe('island');
		expect(rp.plan).toEqual(REGION.decide(rp.inputs));
		expect(rp.resolved).toBeUndefined();
		expect(rp.arm).toBe(rp.plan.arm);
	});

	it("a held value's kind and arm come from the value", () => {
		let rp!: RegionPlan;
		const value = region(Tiny as never, { n: 1 }) as RegionValue;
		inside(() => (rp = plan_of({}, value)));
		expect(rp.placed).toBe(false);
		expect(rp.resolved).toBe(value);
		expect(rp.of_init).toBe(value);
		expect(rp.inputs.kind).toBe(value.kind);
		expect(rp.arm).toBe(value.kind);
	});

	it('a value that is not a branded region is a promise', () => {
		let rp!: RegionPlan;
		inside(() => (rp = plan_of({}, new Promise<RegionValue>(() => {}))));
		expect(rp.of_is_promise).toBe(true);
		expect(rp.inputs.kind).toBe('promise-bare');
		expect(rp.arm).toBe('promise');
	});

	it("on Kit's page pass a region has the page's tail and marks the pass for the regions below", () => {
		let rp!: RegionPlan;
		const tail = inside(() => (rp = plan_of(ISLAND_SETTINGS)), true);
		expect(rp.inputs.request).toBe('no-event');
		expect(rp.plan.root).toBe('kit');
		expect(rp.plan.mark_pass).toBe(true);
		expect(rp.tail).toBe(tail);
	});

	it('off a Kit request a region has no tail', () => {
		let rp!: RegionPlan;
		inside(() => (rp = plan_of(ISLAND_SETTINGS)));
		expect(rp.inputs.request).toBe('none');
		expect(rp.tail).toBeNull();
	});
});

describe('IslandWire', () => {
	it("a placed island's wire carries its props, under its module url and its fingerprint", () => {
		let island!: IslandWire;
		inside(() => {
			const rp = plan_of(ISLAND_SETTINGS);
			island = new IslandWire(
				rp,
				() => ({ n: 1 }),
				() => undefined
			);
		});
		expect(island.entry).toBe(ISLAND);
		expect(island.module_url).toBe(kit_asset(ISLAND));
		expect(island.wake).toEqual({ on: 'load', margin: undefined });
		expect(island.wire?.canonical).toContain('"n"');
		expect(island.fp).not.toBe('');
		expect(island.has_slot_children).toBe(false);
		expect(island.props_inline).toContain(island.fp);
	});

	it('an island with children sends a slot pointer over the wire and renders them in its body', () => {
		let island!: IslandWire;
		inside(() => {
			const rp = plan_of(ISLAND_SETTINGS);
			island = new IslandWire(
				rp,
				() => ({}),
				() => (() => {}) as never
			);
		});
		expect(island.has_slot_children).toBe(true);
		expect(typeof island.props_body?.children).toBe('function');
		expect(island.wire?.canonical).toContain(island.slot_id);
	});

	it('a wake and its margin come from the settings', () => {
		let island!: IslandWire;
		inside(() => {
			const rp = plan_of({ ...ISLAND_SETTINGS, wake: 'visible', wakeMargin: '10px' });
			island = new IslandWire(
				rp,
				() => ({}),
				() => undefined
			);
		});
		expect(island.wake).toEqual({ on: 'visible', margin: '10px' });
	});

	it("on Kit's page pass the props go to the tail, so none are written beside the island", () => {
		let island!: IslandWire;
		inside(() => {
			const rp = plan_of(ISLAND_SETTINGS);
			island = new IslandWire(
				rp,
				() => ({ n: 1 }),
				() => undefined
			);
		}, true);
		expect(island.in_tail).toBe(true);
		expect(island.props_inline).toBe('');
	});
});

describe('IslandGraph', () => {
	function graph_of(on_kit_pass: boolean): IslandGraph {
		let graph!: IslandGraph;
		inside(() => {
			const rp = plan_of(ISLAND_SETTINGS);
			const island = new IslandWire(
				rp,
				() => ({}),
				() => undefined
			);
			graph = new IslandGraph(rp, island);
		}, on_kit_pass);
		return graph;
	}

	it('an island with no deps has no graph and preloads nothing', () => {
		const graph = graph_of(false);
		expect(graph.hrefs).toEqual([]);
		expect(graph.preload_head).toBe('');
	});

	it("an island's deps are its graph, written in the head off Kit's pass", () => {
		set_island_deps({ [ISLAND]: ['/chunks/dep.js'] });
		const graph = graph_of(false);
		expect(graph.hrefs).toEqual([kit_asset('/chunks/dep.js')]);
		expect(graph.preload_head).toContain(kit_asset('/chunks/dep.js'));
	});

	it("on Kit's page pass the graph goes to the tail, not the head", () => {
		set_island_deps({ [ISLAND]: ['/chunks/dep.js'] });
		const graph = graph_of(true);
		expect(graph.in_tail).toBe(true);
		expect(graph.preload_head).toBe('');
	});
});

describe('HoleFacts', () => {
	const HOLE: RegionSettings = { mode: 'server', entry: '/holes/clock', component: Tiny as never };

	beforeEach(() => set_region_endpoints({ mint_server_region: (entry) => `/_og/hole${entry}` }));
	afterEach(() => set_region_endpoints(null));

	function hole_of(settings: RegionSettings): HoleFacts {
		let hole!: HoleFacts;
		inside(() => {
			hole = new HoleFacts(plan_of(settings), () => ({ zone: 'utc' }));
		});
		return hole;
	}

	it("a hole's endpoint is in the attributes of its element", () => {
		const hole = hole_of(HOLE);
		expect(hole.endpoint).not.toBe('');
		expect(hole.when).toBe('load');
		const attrs = hole.attrs();
		expect(attrs).toContain(' render="defer"');
		expect(attrs).toContain(' when="load"');
		expect(attrs).toContain(`endpoint="${hole.endpoint}"`);
		expect(attrs).not.toContain(' wake=');
	});

	it('a hole that wakes carries its props over a wire and names its wake and identity', () => {
		const hole = hole_of({ ...HOLE, wake: 'idle', wakeMargin: '5px' });
		expect(hole.wire).not.toBeNull();
		expect(hole.identity).not.toBe('');
		expect(hole.attrs()).toContain(`data-og-hole="${hole.identity}"`);
		expect(hole.props_script).toContain('utc');
		expect(hole.attrs()).toContain(' wake="idle"');
		expect(hole.attrs()).toContain(' hydrate-margin="5px"');
	});

	it('a hole that never wakes has no wire', () => {
		const hole = hole_of(HOLE);
		expect(hole.wire).toBeNull();
		expect(hole.props_script).toBe('');
	});

	it('a region that is not a hole mints no endpoint', () => {
		const hole = hole_of(ISLAND_SETTINGS);
		expect(hole.endpoint).toBe('');
		expect(hole.identity).toBe('');
	});
});

describe('RegionHead', () => {
	function heads(count: number): { runtime: string; owner: string; html: string }[] {
		const out: { runtime: string; owner: string; html: string }[] = [];
		const event = { route: { id: '/heads' } };
		set_request_event_stub(() => event);
		try {
			inside(() => {
				for (let n = 0; n < count; n++) {
					const rp = plan_of(ISLAND_SETTINGS);
					const island = new IslandWire(
						rp,
						() => ({}),
						() => undefined
					);
					const graph = new IslandGraph(rp, island);
					const head = new RegionHead(rp, island, graph, new HoleFacts(rp, () => ({})));
					out.push({ runtime: head.runtime, owner: head.owner, html: head.html });
				}
			});
		} finally {
			set_request_event_stub(null);
		}
		return out;
	}

	it('the first region on a page claims the runtime, the next one does not', () => {
		const [first, second] = heads(2);
		expect(first!.runtime).not.toBe('');
		expect(second!.runtime).toBe('');
	});

	it("an island's sheets are written once per page, owned by the first island", () => {
		set_island_css({ [ISLAND]: ['/assets/tiny.css'] });
		const [first, second] = heads(2);
		expect(first!.owner).not.toBe('');
		expect(first!.html).toContain(kit_asset('/assets/tiny.css'));
		expect(second!.html).not.toContain(kit_asset('/assets/tiny.css'));
	});
});

describe('PageSeedAsk', () => {
	it("a plan's seed names the module it asks about", () => {
		expect(PageSeedAsk.entry_of('island', '/i.js', '/h.js', '/d.js')).toBe('/i.js');
		expect(PageSeedAsk.entry_of('hole', '/i.js', '/h.js', '/d.js')).toBe('/h.js');
		expect(PageSeedAsk.entry_of('held', '/i.js', '/h.js', '/d.js')).toBe('/d.js');
		expect(PageSeedAsk.entry_of('promise', '/i.js', '/h.js', '/d.js')).toBeNull();
		expect(PageSeedAsk.entry_of('none', '/i.js', '/h.js', '/d.js')).toBe('');
	});

	it('a promise asks for the whole seed and any remote', () => {
		expect(new PageSeedAsk(null)).toMatchObject({ entry: '', seed: 'all', remotes: null });
	});

	it('no module asks for nothing', () => {
		expect(new PageSeedAsk('')).toMatchObject({ entry: '', seed: false, remotes: [] });
	});

	it('a module that reads no page asks for no seed, only its remotes', () => {
		set_island_remotes(['r1']);
		expect(new PageSeedAsk('/m.js')).toMatchObject({
			entry: '/m.js',
			seed: false,
			remotes: ['r1']
		});
	});

	it('a module that reads the page asks for its keys, or all of it when the keys are unknown', () => {
		set_reads_page(true);
		set_page_keys(['user']);
		expect(new PageSeedAsk('/m.js').seed).toEqual(['user']);
		set_page_keys(null);
		expect(new PageSeedAsk('/m.js').seed).toBe('all');
	});
});
