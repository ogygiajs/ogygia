import { untrack } from 'svelte';
import {
	content_css,
	head_owner_attr,
	hole_css,
	region_css,
	region_css_tag,
	runtime_bootstrap
} from '#region-server';
import { dev_hmr_url } from '../dev-hmr-url.ts';
import { kit_asset } from '../kit-paths.ts';
import { escape_amp_quot } from '../escape.ts';
import { OGYGIA_DEV_HMR } from '../wire-markup.ts';
import {
	claimRuntimeEmit,
	claim_region_css,
	claim_kit_island,
	head_owner,
	set_head_owner
} from '../context.ts';
import type { HoleFacts } from './hole-facts.svelte.ts';
import type { IslandGraph } from './island-graph.svelte.ts';
import type { IslandWire } from './island-wire.svelte.ts';
import type { RegionPlan } from './plan.svelte.ts';

/** What a region writes into the page's head: the runtime, its preloads and graph, its sheets and
 *  Kit's island mark, each claimed once per page and tagged with the island that owns them. */
export class RegionHead {
	readonly #rp: RegionPlan;
	readonly #island: IslandWire | null;
	readonly #graph: IslandGraph | null;
	readonly #hole: HoleFacts | null;

	readonly owner: string;
	readonly runtime: string;

	#dual_css: string = $derived.by(() => {
		const value = this.#rp.resolved;
		return value?.kind === 'dual' ? this.sheet_tags(region_css(value.module)) : '';
	});
	#island_css: string = $derived.by(() => {
		const entry = this.#island?.entry;
		return !this.#rp.plan.island_css || !entry ? '' : this.sheet_tags(region_css(entry));
	});
	#kit_meta: string = $derived.by(() => {
		const entry = this.#island?.entry;
		if (!this.#rp.plan.kit_meta || !entry || !claim_kit_island(entry)) return '';
		const content = escape_amp_quot(String(entry));
		return `<meta name="ogygia-kit-island" content="${content}"${head_owner_attr(this.owner)}>`;
	});
	#content_css: string = $derived.by(() => {
		const value = this.#rp.resolved;
		return value?.kind !== 'inline' || !value.content_id
			? ''
			: this.sheet_tags(content_css(value.content_id));
	});
	#hole_css: string = $derived.by(() =>
		this.#rp.plan.hole_css && this.#hole ? this.sheet_tags(hole_css(this.#hole.entry)) : ''
	);
	html: string = $derived.by(() => {
		const head = this.#rp.plan.head;
		if (head === 'none') return '';
		if (head === 'island')
			return `${this.runtime}${this.#graph?.preload_head ?? ''}${this.#island_css}${this.#kit_meta}${this.#dual_css}${this.#content_css}`;
		if (head === 'hole')
			return `${this.runtime}${this.#hole?.preload ?? ''}${this.#hole_css}${this.#dual_css}${this.#content_css}`;
		return `${this.runtime}${this.#dual_css}${this.#content_css}`;
	});

	/** A region's head, on the server: it names the owner of its head tags (the island around it,
	 *  else its own island) and claims the page's runtime script when its plan asks for it. */
	constructor(
		rp: RegionPlan,
		parts: { island: IslandWire | null; graph: IslandGraph | null; hole: HoleFacts | null }
	) {
		this.#rp = rp;
		this.#island = parts.island;
		this.#graph = parts.graph;
		this.#hole = parts.hole;
		const outer = head_owner();
		this.owner = outer || untrack(() => parts.island?.fp ?? '');
		if (!outer && this.owner) set_head_owner(this.owner);
		this.runtime =
			rp.plan.runtime && claimRuntimeEmit()
				? runtime_bootstrap(kit_asset) +
					(dev_hmr_url
						? `<script type="module" ${OGYGIA_DEV_HMR} src="${kit_asset(dev_hmr_url)}"></script>`
						: '')
				: '';
	}

	/** The `<link>` tags for the sheets this region is the first to claim on the page. */
	sheet_tags(hrefs: string[]): string {
		const tail = this.#rp.tail;
		const owner = this.owner;
		const shared = tail ? (href: string) => tail.sheet_owner(kit_asset(href), owner) : undefined;
		let html = '';
		for (const href of claim_region_css(hrefs, owner, shared) ?? [])
			html += region_css_tag(href, kit_asset(href), owner);
		return html;
	}
}
