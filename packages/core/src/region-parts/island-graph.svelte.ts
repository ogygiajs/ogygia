import { untrack } from 'svelte';
import { island_graph_script, modulepreload_tag } from '../server/document-tail.ts';
import { graph_hrefs, location_of } from './locate.ts';
import type { IslandWire } from './island-wire.svelte.ts';
import type { RegionPlan } from './plan.svelte.ts';

/** The chunks an island's module needs, and how the page learns them: Kit's preload hints, the
 *  document tail's graph, or a graph script of its own in the head. */
export class IslandGraph {
	readonly #rp: RegionPlan;
	readonly #island: IslandWire;

	live_locations: Map<string, string> | null = $derived.by(() => {
		const live = this.#island.wire?.live_entries;
		if (!live?.length) return null;
		const out: Map<string, string> = new Map();
		for (const m of live) {
			const loc = location_of(m);
			if (loc) out.set(m, loc);
		}
		return out.size ? out : null;
	});
	hrefs: string[] = $derived.by(() =>
		!this.#island.module_url
			? []
			: graph_hrefs(this.#island.entry, this.#island.module_url, this.#island.wire?.live_entries)
	);
	kit_hints: string[] = $derived.by(() =>
		this.#rp.plan.csr && this.#island.wake.on === 'load' && this.#island.src
			? [this.#island.src, ...this.hrefs]
			: []
	);
	preload_head: string = $derived.by(() => (this.#rp.tail ? '' : this.#preload()));

	constructor(rp: RegionPlan, island: IslandWire) {
		this.#rp = rp;
		this.#island = island;
	}

	/** An island's graph in its place: on Kit's pass it goes to the page's tail. */
	static place(rp: RegionPlan, island: IslandWire): IslandGraph {
		const graph = new IslandGraph(rp, island);
		untrack(() => graph.#record());
		return graph;
	}

	#record(): void {
		const tail = this.#rp.tail;
		if (!tail) return;
		const island = this.#island;
		const url = island.module_url;
		if (this.live_locations) for (const [m, loc] of this.live_locations) tail.locate(m, loc);
		if (this.kit_hints.length) tail.hints(this.kit_hints, island.fp);
		else if (!this.#rp.plan.csr && url) {
			const hrefs = tail.graph_of(url) ?? this.hrefs;
			if (hrefs.length) tail.graph(url, hrefs, island.fp, island.src);
		}
	}

	#preload(): string {
		if (this.kit_hints.length) return this.kit_hints.map(modulepreload_tag).join('');
		if (this.#rp.plan.csr || (!this.hrefs.length && !this.live_locations)) return '';
		return island_graph_script(
			new Map([[this.#island.module_url, this.hrefs]]),
			this.live_locations
		);
	}
}
