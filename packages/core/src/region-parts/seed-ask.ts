import { page } from '$app/state';
import { region_page_keys, region_reads_page, region_remotes } from '#region-server';
import { record_page } from '../page-seed-registry.ts';
import type { SeedAsk } from '../server/seed-shape.ts';
import type { DeferredRegion } from '../region.ts';
import type { IslandWire } from './island-wire.svelte.ts';
import type { RegionPlan } from './plan.svelte.ts';

/** What a region asks the page seed for: the module whose page reads count, the page keys it
 *  reads, and the remote functions it calls. A promise may read anything, so it asks for all. */
export class PageSeedAsk {
	readonly #rp: RegionPlan;
	readonly #island: IslandWire | null;

	constructor(rp: RegionPlan, island: IslandWire | null) {
		this.#rp = rp;
		this.#island = island;
	}

	get #module(): string | null {
		const seed = this.#rp.plan.seed;
		if (seed === 'island') return this.#island?.entry ?? '';
		if (seed === 'hole') return this.#rp.settings.module ?? '';
		if (seed === 'held') return (this.#rp.of_init as DeferredRegion | undefined)?.module ?? '';
		return seed === 'promise' ? null : '';
	}

	/** The module the ask is about: the island's, the hole's, or the held value's (`''`: none). */
	get entry(): string {
		return this.#module ?? '';
	}

	/** The page keys the module reads, `'all'` when they are unknown, `false` when it reads none. */
	get seed(): SeedAsk {
		const module = this.#module;
		if (module === null) return 'all';
		return module && region_reads_page(module) ? (region_page_keys(module) ?? 'all') : false;
	}

	/** The remote functions the module calls (`null`: any). */
	get remotes(): readonly string[] | null {
		const module = this.#module;
		if (module === null) return null;
		return module ? region_remotes(module) : [];
	}

	/** Hands the ask to the page seed recorder, with the page it reads (on the server only). */
	record(): void {
		if (typeof window === 'undefined') {
			try {
				record_page(
					{ data: page.data, form: page.form, error: page.error, status: page.status },
					this.seed,
					this.remotes,
					this.entry
				);
				// oxlint-disable-next-line ogygia/no-silent-failures -- an isolated render without a live page; the recorder is unset there anyway
			} catch {}
		}
	}
}
