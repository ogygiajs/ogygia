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
import type { DualRegion, RegionValue } from '../region.ts';
import SlotBoundary from '../SlotBoundary.svelte';
import { location_of } from './locate.ts';
import type { RegionPlan } from './plan.svelte.ts';

type Renderer = { push(html: string): void };
type Props = Record<string, unknown> | undefined;

/** An island's code and props as the page carries them: its module, its component and props, its
 *  wake, the wire its props travel in, and its fingerprint. */
export class IslandWire {
	readonly #rp: RegionPlan;
	readonly #props: () => Props;
	readonly #children: () => Snippet | undefined;
	readonly slot_id: string;

	as_dual: DualRegion | undefined = $derived.by(() =>
		IslandWire.#dual_of(this.#rp, this.#rp.resolved)
	);
	entry: string = $derived.by(() => IslandWire.#entry_of(this.#rp, this.as_dual));
	component: Component | undefined = $derived.by(() =>
		this.as_dual ? (this.as_dual.component as Component) : this.#rp.settings.component
	);
	props: Props = $derived.by(() => (this.as_dual ? (this.as_dual.props as Props) : this.#props()));
	props_ready: Props = $derived.by(() =>
		this.#rp.plan.inline ? this.props : prepare_region_props(this.props!)
	);
	has_slot_children: boolean = $derived.by(() => this.#children() != null);
	props_body: Props = $derived.by(() =>
		this.has_slot_children && typeof window === 'undefined'
			? { ...this.props_ready, children: this.#slot_children }
			: this.props_ready
	);
	wake: { on: string; margin: string | undefined } = $derived.by(() =>
		this.as_dual
			? { on: this.as_dual.hydrate!, margin: this.as_dual.hydrateMargin || undefined }
			: { on: this.#rp.settings.wake || 'load', margin: this.#rp.settings.wakeMargin }
	);
	module_url: string = $derived.by(() =>
		this.#rp.plan.nested || !this.entry ? '' : kit_asset(this.entry)
	);
	src: string = $derived.by(() =>
		this.#rp.plan.nested || !this.entry ? '' : location_of(this.entry)
	);
	wire: PropsWire | null = $derived.by(() =>
		this.#rp.plan.wire === 'island'
			? new PropsWire(
					this.has_slot_children
						? { ...this.props_ready, children: slot_pointer(this.slot_id) }
						: this.props_ready,
					this.entry
				)
			: null
	);
	fp: string = $derived.by(() =>
		this.wire ? region_fingerprint(this.module_url, this.wire.canonical) : ''
	);
	skip: boolean = $derived.by(
		() =>
			!this.has_slot_children &&
			(this.#rp.settings.cacheTtl ?? 0) <= 0 &&
			!!this.fp &&
			reuse_known_region(this.fp)
	);
	in_tail: boolean = $derived.by(() => !!this.#rp.tail && !!this.wire && !!this.fp);
	props_inline: string = $derived.by(() =>
		this.in_tail || !this.wire
			? ''
			: props_sidecar(this.fp, this.wire.wire(null), 'adjacent', this.wire.wire_modules)
	);

	constructor(
		rp: RegionPlan,
		props: () => Props,
		children: () => Snippet | undefined,
		slot_id: string
	) {
		this.#rp = rp;
		this.#props = props;
		this.#children = children;
		this.slot_id = slot_id;
	}

	/** A late island's loader, where the browser renders the island inline with no component yet. */
	get late_load(): (() => Promise<Component>) | undefined {
		return this.#rp.plan.late_load ? this.#rp.settings.load : undefined;
	}

	/** An island in its place: it claims its slot id, warns about a wake its parent overrides, and
	 *  hands its props to Kit's tail when the page has one. */
	static place(
		rp: RegionPlan,
		props: () => Props,
		children: () => Snippet | undefined
	): IslandWire {
		const entry = IslandWire.#entry_of(rp, IslandWire.#dual_of(rp, rp.of_init));
		const island = new IslandWire(
			rp,
			props,
			children,
			next_slot_id(entry, getContext(HOLE_SLOT_SEQUENCE))
		);
		untrack(() => island.#record());
		return island;
	}

	static #dual_of(rp: RegionPlan, value: RegionValue | undefined): DualRegion | undefined {
		return rp.plan.family === 'island' && value?.kind === 'dual' ? value : undefined;
	}

	static #entry_of(rp: RegionPlan, dual: DualRegion | undefined): string {
		if (dual) return dual.module;
		return rp.settings.mode === 'island' ? (rp.settings.entry ?? '') : '';
	}

	#record(): void {
		const plan = this.#rp.plan;
		if (
			import.meta.env &&
			import.meta.env.DEV &&
			plan.warn === 'island-parent' &&
			this.wake.on !== nested_wake()
		)
			warn('nested_island_with_parent', { entry: this.entry || '' });
		const tail = this.#rp.tail;
		if (!tail || !this.in_tail) return;
		tail.props(this.fp, this.wire!, {
			entry: this.entry,
			name: this.component?.name ?? '',
			module_url: this.src || this.module_url,
			wake: this.wake.on,
			interactivity: region_interactivity(this.entry)
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
