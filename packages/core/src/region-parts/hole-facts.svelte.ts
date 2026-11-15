import { untrack } from 'svelte';
import { building } from '$app/env';
import { mint_server_region } from '#region-server';
import { kit_page_version } from '../server/kit-context.ts';
import { hole_copy_of } from '../contract/hash.ts';
import { kit_asset } from '../kit-paths.ts';
import { island_graph_script } from '../server/document-tail.ts';
import { hole_identity, PropsWire, props_sidecar } from '../server/props-wire.ts';
import { record_server_event } from '../events/server-registry.ts';
import { escape_attr } from '../escape.ts';
import { OG_HOLE } from '../wire-markup.ts';
import { warn } from '../messages/island.ts';
import { note_early_hole } from '../context.ts';
import { graph_hrefs, location_of } from './locate.ts';
import type { RegionPlan } from './plan.svelte.ts';

type Props = Record<string, unknown> | undefined;

/** A hole's facts: the endpoint that renders it, its module and identity, the wire its props travel
 *  in, and the records it leaves in the document tail. */
export class HoleFacts {
	readonly #rp: RegionPlan;
	readonly #props: () => Props;

	endpoint: string = $derived.by(() =>
		this.#rp.plan.family !== 'hole'
			? ''
			: mint_server_region(
					this.entry,
					this.#props() || {},
					this.#rp.settings.cacheTtl || 0,
					!!this.wake
				) + kit_page_version(this.entry)
	);
	entry_url: string = $derived.by(() =>
		!this.#rp.plan.nested && this.module ? kit_asset(this.module) : ''
	);
	src: string = $derived.by(() => (this.module ? location_of(this.module) : ''));
	wire: PropsWire | null = $derived.by(() =>
		this.#rp.plan.wire === 'hole' ? new PropsWire(this.#props(), this.entry) : null
	);
	props_script: string = $derived.by(() =>
		this.wire ? props_sidecar('', this.wire.wire(null), 'adjacent', this.wire.wire_modules) : ''
	);
	identity: string = $derived.by(() =>
		this.#rp.plan.nested || this.#rp.plan.family !== 'hole'
			? ''
			: hole_identity(this.entry, this.#props(), this.wire)
	);
	graph: string[] = $derived.by(() =>
		!this.#rp.plan.hole_graph || !this.entry_url
			? []
			: graph_hrefs(this.module, this.entry_url, null)
	);
	preload: string = $derived.by(() =>
		this.#rp.tail || !this.graph.length
			? ''
			: island_graph_script(new Map([[this.entry_url, this.graph]]))
	);

	constructor(rp: RegionPlan, props: () => Props) {
		this.#rp = rp;
		this.#props = props;
	}

	/** The component that renders the hole. */
	get entry(): string {
		return this.#rp.settings.entry ?? '';
	}

	/** The module that wakes the hole's HTML, or `''`. */
	get module(): string {
		return this.#rp.settings.module ?? '';
	}

	/** When the hole's endpoint is fetched. */
	get when(): string {
		return this.#rp.settings.when ?? 'load';
	}

	/** The hole's wake, when it has a module that wakes. */
	get wake(): string | undefined {
		return this.#rp.settings.mode === 'server' ? this.#rp.settings.wake : undefined;
	}

	/** The hole's wake margin. */
	get wake_margin(): string | undefined {
		return this.#rp.settings.mode === 'server' ? this.#rp.settings.wakeMargin : undefined;
	}

	/** A hole in its place (`null` for a region that is not a hole): it warns when it renders
	 *  inline, and leaves its records in Kit's tail. */
	static place(rp: RegionPlan, props: () => Props): HoleFacts | null {
		if (rp.plan.family !== 'hole') return null;
		const hole = new HoleFacts(rp, props);
		untrack(() => hole.#record());
		return hole;
	}

	#record(): void {
		const plan = this.#rp.plan;
		if (import.meta.env && import.meta.env.DEV && plan.warn === 'hole-inline')
			warn('nested_server_island_inline', { entry: this.entry });
		const tail = this.#rp.tail;
		if (tail && plan.hole_tail && this.endpoint)
			tail.hole(this.identity, this.endpoint, this.props_script);
		if (tail && plan.note_hole)
			tail.note_hole(
				this.entry,
				this.when,
				this.wake || null,
				this.#rp.settings.cacheTtl || 0,
				this.#rp.settings.component?.name ?? '',
				this.#props(),
				this.endpoint ? hole_copy_of(this.endpoint) : ''
			);
		if (plan.early_hole && !building && this.when === 'load' && this.endpoint)
			note_early_hole(this.endpoint);
		if (tail && this.graph.length) tail.graph(this.entry_url, this.graph);
	}

	/** The attributes of the hole's own `<ogygia-region>`, as the shell and the adopted element write them. */
	attrs = (): string => {
		const a = (name: string, v: unknown) =>
			v == null || v === '' ? '' : ` ${name}="${escape_attr(String(v))}"`;
		const s = this.#rp.settings;
		return ` entry="${escape_attr(this.entry_url)}" render="defer"${a('stitch', s.stitch ?? '')}${a('prefetch', s.prefetch ?? '')}${a('when', this.when)}${a('wake', this.wake)}${a('margin', s.margin)}${a('hydrate-margin', this.wake_margin)} endpoint="${escape_attr(this.endpoint)}"${a(OG_HOLE, this.identity)}${a('src', this.src)}`;
	};

	/** Tells devtools this hole rendered on the server. */
	record_devtools(): void {
		record_server_event({
			domain: 'server',
			name: 'server.region.rendered',
			fp: '',
			mode: 'server',
			entry: this.entry_url || undefined,
			propsBytes: this.wire?.canonical.length ?? 0
		});
	}
}
