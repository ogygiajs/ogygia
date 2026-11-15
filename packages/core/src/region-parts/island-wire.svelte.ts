import { getContext, untrack, type Component, type Snippet } from 'svelte';
import { region_fingerprint, region_interactivity, reuse_known_region } from '#region-server';
import { kit_asset } from '../kit-paths.ts';
import { PropsWire, props_sidecar } from '../server/props-wire.ts';
import { record_server_event } from '../events/server-registry.ts';
import { warn } from '../messages/island.ts';
import { nested_wake } from '../context.ts';
import {
	prepare_region_props,
	slot_pointer,
	slot_marker_open,
	SLOT_MARKER_CLOSE,
	next_slot_id,
	HOLE_SLOT_SEQUENCE
} from '../region-snippet.ts';
import type { DualRegion } from '../region.ts';
import SlotBoundary from '../SlotBoundary.svelte';
import { location_of } from './locate.ts';
import type { RegionPlan } from './plan.svelte.ts';

type Renderer = { push(html: string): void };
type Props = Record<string, unknown> | undefined;

/** An island's code and props as the page carries them: its module, its component and props, its
 *  wake, the wire its props travel in, and its fingerprint. */
export class IslandWire {
	readonly #children: () => Snippet | undefined;
	readonly slot_id: string;
	readonly late_load: (() => Promise<Component>) | undefined;
	readonly in_tail: boolean;
	as_dual: DualRegion | undefined;
	entry: string;
	component: Component | undefined;
	props: Props;
	props_ready: Props;
	has_slot_children: boolean;
	props_body: Props;
	wake: { on: string; margin: string | undefined };
	module_url: string;
	src: string;
	wire: PropsWire | null;
	fp: string;
	skip: boolean;
	props_inline: string;

	constructor(rp: RegionPlan, props: () => Props, children: () => Snippet | undefined) {
		this.#children = children;
		const plan = rp.plan;
		const s = rp.settings;
		this.as_dual = $derived.by(() => {
			const value = rp.resolved;
			return plan.family === 'island' && value?.kind === 'dual' ? value : undefined;
		});
		this.entry = $derived(this.as_dual?.module ?? (s.mode === 'island' ? (s.entry ?? '') : ''));
		this.component = $derived(this.as_dual ? (this.as_dual.component as Component) : s.component);
		this.props = $derived(this.as_dual ? (this.as_dual.props as Props) : props());
		this.props_ready = $derived(plan.inline ? this.props : prepare_region_props(this.props!));
		this.has_slot_children = $derived(children() != null);
		this.props_body = $derived(
			this.has_slot_children && typeof window === 'undefined'
				? { ...this.props_ready, children: this.#slot_children }
				: this.props_ready
		);
		this.wake = $derived(
			this.as_dual
				? { on: this.as_dual.hydrate!, margin: this.as_dual.hydrateMargin || undefined }
				: { on: s.wake || 'load', margin: s.wakeMargin }
		);
		this.module_url = $derived(plan.nested || !this.entry ? '' : kit_asset(this.entry));
		this.src = $derived(plan.nested || !this.entry ? '' : location_of(this.entry));
		this.wire = $derived.by(() =>
			plan.wire === 'island'
				? new PropsWire(
						this.has_slot_children
							? { ...this.props_ready, children: slot_pointer(this.slot_id) }
							: this.props_ready,
						this.entry
					)
				: null
		);
		this.fp = $derived(this.wire ? region_fingerprint(this.module_url, this.wire.canonical) : '');
		this.skip = $derived(
			!this.has_slot_children && (s.cacheTtl ?? 0) <= 0 && !!this.fp && reuse_known_region(this.fp)
		);
		this.props_inline = $derived.by(() =>
			this.in_tail || !this.wire
				? ''
				: props_sidecar(this.fp, this.wire.wire(null), 'adjacent', this.wire.wire_modules)
		);
		this.late_load = plan.late_load ? s.load : undefined;
		this.slot_id = next_slot_id(untrack(() => this.entry) ?? '', getContext(HOLE_SLOT_SEQUENCE));
		if (import.meta.env && import.meta.env.DEV) {
			untrack(() => {
				if (plan.warn === 'island-parent' && this.wake.on !== nested_wake())
					warn('nested_island_with_parent', { entry: this.entry || '' });
			});
		}
		const tail = rp.tail;
		this.in_tail =
			!!tail &&
			untrack(() => {
				const wire = this.wire;
				const fp = this.fp;
				if (!wire || !fp) return false;
				tail.props(fp, wire, {
					entry: this.entry,
					name: this.component?.name ?? '',
					module_url: this.src || this.module_url,
					wake: this.wake.on,
					interactivity: region_interactivity(this.entry)
				});
				return true;
			});
	}

	#slot_children = (renderer: Renderer): void => {
		renderer.push(slot_marker_open(this.slot_id));
		SlotBoundary(renderer as never, { children: this.#children() });
		renderer.push(SLOT_MARKER_CLOSE);
	};

	/** Tells devtools this island rendered on the server, and whether the page already had it. */
	record_devtools(): void {
		record_server_event({
			domain: 'server',
			name: 'server.region.rendered',
			fp: this.fp || '',
			mode: 'island',
			entry: this.module_url || undefined,
			propsBytes: this.wire?.canonical.length ?? 0
		});
		if (this.skip)
			record_server_event({ domain: 'server', name: 'server.delta.skip', fp: this.fp || '' });
	}
}
