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

/** A hole's facts: the endpoint that renders it, its module and identity, the wire its props travel
 *  in, and the records it leaves in the document tail. */
export class HoleFacts {
	readonly #rp: RegionPlan;
	readonly entry: string;
	readonly module: string;
	readonly when: string;
	readonly wake: string | undefined;
	readonly wake_margin: string | undefined;
	readonly graph_in_tail: boolean;

	endpoint: string;
	entry_url: string;
	src: string;
	wire: PropsWire | null;
	props_script: string;
	identity: string;
	graph: string[];
	preload: string;

	constructor(rp: RegionPlan, props: () => Record<string, unknown> | undefined) {
		this.#rp = rp;
		const s = rp.settings;
		const plan = rp.plan;
		this.entry = s.entry ?? '';
		this.module = s.module ?? '';
		this.when = s.when ?? 'load';
		this.wake = s.mode === 'server' ? s.wake : undefined;
		this.wake_margin = s.mode === 'server' ? s.wakeMargin : undefined;
		this.endpoint = $derived(
			plan.family !== 'hole'
				? ''
				: mint_server_region(this.entry, props() || {}, s.cacheTtl || 0, !!this.wake) +
						kit_page_version(this.entry)
		);
		this.entry_url = $derived(!plan.nested && this.module ? kit_asset(this.module) : '');
		this.src = $derived(this.module ? location_of(this.module) : '');
		this.wire = $derived(plan.wire === 'hole' ? new PropsWire(props(), this.entry) : null);
		this.props_script = $derived(
			this.wire ? props_sidecar('', this.wire.wire(null), 'adjacent', this.wire.wire_modules) : ''
		);
		this.identity = $derived(
			plan.nested || plan.family !== 'hole' ? '' : hole_identity(this.entry, props(), this.wire)
		);
		this.graph = $derived(
			!plan.hole_graph || !this.entry_url ? [] : graph_hrefs(this.module, this.entry_url, null)
		);
		this.preload = $derived.by(() =>
			this.graph_in_tail || !this.graph.length
				? ''
				: island_graph_script(new Map([[this.entry_url, this.graph]]))
		);
		if (import.meta.env && import.meta.env.DEV && plan.warn === 'hole-inline')
			warn('nested_server_island_inline', { entry: this.entry });
		const tail = rp.tail;
		if (tail && plan.hole_tail) {
			untrack(() => {
				const endpoint = this.endpoint;
				if (endpoint) tail.hole(this.identity, endpoint, this.props_script);
			});
		}
		if (tail && plan.note_hole)
			untrack(() =>
				tail.note_hole(
					this.entry,
					this.when,
					this.wake || null,
					s.cacheTtl || 0,
					s.component?.name ?? '',
					props(),
					this.endpoint ? hole_copy_of(this.endpoint) : ''
				)
			);
		if (plan.early_hole && !building)
			untrack(() => {
				if (this.when === 'load' && this.endpoint) note_early_hole(this.endpoint);
			});
		this.graph_in_tail =
			!!tail &&
			untrack(() => {
				if (this.graph.length) tail.graph(this.entry_url, this.graph);
				return true;
			});
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
