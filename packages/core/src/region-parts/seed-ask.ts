import { page } from '$app/state';
import { region_page_keys, region_reads_page, region_remotes } from '#region-server';
import { record_page } from '../page-seed-registry.ts';
import type { SeedAsk } from '../server/seed-shape.ts';
import type { RegionDecision } from '../region-plan.ts';

/** What a region asks the page seed for: the module whose page reads count (`null`: a promise,
 *  which may read anything), the page keys it reads, and the remote functions it calls. */
export class PageSeedAsk {
	readonly entry: string;
	readonly seed: SeedAsk;
	readonly remotes: readonly string[] | null;

	constructor(entry: string | null) {
		if (entry === null) {
			this.entry = '';
			this.seed = 'all';
			this.remotes = null;
			return;
		}
		this.entry = entry;
		this.remotes = entry ? region_remotes(entry) : [];
		this.seed = entry && region_reads_page(entry) ? (region_page_keys(entry) ?? 'all') : false;
	}

	/** The module a plan's seed ask is about: the island's, the hole's, or the held value's. */
	static entry_of(
		seed: RegionDecision['seed'],
		island: string,
		hole: string,
		held: string | undefined
	): string | null {
		if (seed === 'island') return island;
		if (seed === 'hole') return hole;
		if (seed === 'held') return held ?? '';
		return seed === 'promise' ? null : '';
	}

	/** Hands the ask to the page seed recorder, with the page it reads. */
	record(): void {
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
