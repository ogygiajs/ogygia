import type { Snippet } from 'svelte';
import { written_order } from '../frame.ts';
import { OG_BAKED } from '../wire-markup.ts';
import type { DeferredRegion } from '../region.ts';
import { adopt_region } from './adopt.ts';
import type { RegionPlan } from './plan.svelte.ts';

type LiveElement = Element & { applyLive?: (v: unknown) => void };

/** A held live value and the element that shows it. An unbaked one attaches to the element it
 *  renders; a baked one adopts the element the server wrote, which its snippet owns: each new value
 *  is handed to that element while the snippet lives, and none once it is gone. */
export class LiveValue {
	readonly #rp: RegionPlan;
	readonly baked: Snippet = adopt_region(
		() => (typeof window === 'undefined' ? ` live ${OG_BAKED}` : ' live'),
		(renderer) => (renderer as { push(html: string): void }).push(this.#value().html ?? ''),
		(el) => {
			// @why Svelte defers a $effect made in a branch before mount to the component, which outlives the branch (test: test/browser/region-client.test.ts › a baked live value that turns into an unbaked live one hands each value to one element only)
			$effect.pre(() => {
				$effect(() => this.attach(el));
			});
		}
	);

	constructor(rp: RegionPlan) {
		this.#rp = rp;
	}

	#value(): DeferredRegion {
		return this.#rp.resolved as DeferredRegion;
	}

	/** Hands the region's value, as it is now, to the element that shows it. */
	attach = (node: LiveElement): void => {
		const f = this.#value();
		node.applyLive?.({
			id: f.id,
			module: f.module,
			props: f.props,
			html: f.html,
			url: f.url,
			hydrate: f.hydrate,
			hydrateMargin: f.hydrateMargin,
			written: written_order(f)
		});
	};
}
