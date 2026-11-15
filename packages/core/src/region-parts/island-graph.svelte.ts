import { untrack } from 'svelte';
import { island_graph_script, modulepreload_tag } from '../server/document-tail.ts';
import { graph_hrefs, location_of } from './locate.ts';
import type { IslandWire } from './island-wire.svelte.ts';
import type { RegionPlan } from './plan.svelte.ts';

/** The chunks an island's module needs, and how the page learns them: Kit's preload hints, the
 *  document tail's graph, or a graph script of its own in the head. */
export class IslandGraph {
	readonly #csr: boolean;
	readonly #island: IslandWire;
	readonly in_tail: boolean;
	live_locations: Map<string, string> | null;
	hrefs: string[];
	kit_hints: string[];
	preload_head: string;

	constructor(rp: RegionPlan, island: IslandWire) {
		this.#csr = rp.plan.csr;
		this.#island = island;
		this.live_locations = $derived.by(() => {
			const live = island.wire?.live_entries;
			if (!live?.length) return null;
			const out: Map<string, string> = new Map();
			for (const m of live) {
				const loc = location_of(m);
				if (loc) out.set(m, loc);
			}
			return out.size ? out : null;
		});
		this.hrefs = $derived.by(() =>
			!island.module_url
				? []
				: graph_hrefs(island.entry, island.module_url, island.wire?.live_entries)
		);
		this.kit_hints = $derived(
			this.#csr && island.wake.on === 'load' && island.src ? [island.src, ...this.hrefs] : []
		);
		this.preload_head = $derived.by(() => (this.in_tail ? '' : this.#preload()));
		const tail = rp.tail;
		this.in_tail =
			!!tail &&
			untrack(() => {
				const url = island.module_url;
				if (this.live_locations) for (const [m, loc] of this.live_locations) tail.locate(m, loc);
				if (this.kit_hints.length) tail.hints(this.kit_hints, island.fp);
				else if (!this.#csr && url) {
					const hrefs = tail.graph_of(url) ?? this.hrefs;
					if (hrefs.length) tail.graph(url, hrefs, island.fp, island.src);
				}
				return true;
			});
	}

	#preload(): string {
		if (this.kit_hints.length) return this.kit_hints.map(modulepreload_tag).join('');
		if (this.#csr || (!this.hrefs.length && !this.live_locations)) return '';
		return island_graph_script(
			new Map([[this.#island.module_url, this.hrefs]]),
			this.live_locations
		);
	}
}
