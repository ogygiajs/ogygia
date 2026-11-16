<!--
@component
A region: one place on a page whose HTML the server renders and whose code, if any, wakes on its own
schedule. `<Region of={value} />` renders a held region value from `region()`, or a promise of one (a
remote call); `placeholder` shows while it is not ready yet. Placed regions (`wake`, `render`,
`'none'` on an import) render through it too, through the props the compiler writes.
-->
<script lang="ts" module>
	import type { RegionSettings } from './region-plan.ts';
	import { SnippetRender } from './snippet-render.ts';

	export type { RegionSettings };

	const NO_SETTINGS: RegionSettings = {};

	SnippetRender.install();
</script>

<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { stringify } from 'devalue';
	import { props_sidecar } from './server/props-wire.ts';
	import { record_server_event } from './events/server-registry.ts';
	import type { DeferredRegion, DualRegion, InlineRegion, RegionValue } from './region.ts';
	import { location_of } from './region-parts/locate.ts';
	import { RegionPlan } from './region-parts/plan.svelte.ts';
	import { IslandWire } from './region-parts/island-wire.svelte.ts';
	import { IslandGraph } from './region-parts/island-graph.svelte.ts';
	import { HoleFacts } from './region-parts/hole-facts.svelte.ts';
	import { RegionHead } from './region-parts/head.svelte.ts';
	import { PageSeedAsk } from './region-parts/seed-ask.ts';
	import { LiveValue } from './region-parts/live-value.svelte.ts';
	import LateIsland from './LateIsland.svelte';
	import PromiseRegion from './PromiseRegion.svelte';
	import HoleRegion from './HoleRegion.svelte';
	import LakeRegion from './LakeRegion.svelte';

	const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

	/** A region's props: `of` and its waiting UI for a held region; `__og` and the `__props` it renders, from the compiler, for a placed one. */
	interface Props {
		/** The region to render: a value from `region()`, or a promise of one (a remote call). */
		of?: RegionValue | Promise<RegionValue>;
		/** What shows while a promise `of` is in flight, and while a live region's HTML is still on its way. */
		placeholder?: Snippet;
		/** The rendered component's children; where there is no `placeholder`, the waiting UI. */
		children?: Snippet;
		__og?: RegionSettings;
		__props?: Record<string, unknown>;
		ogygiaFallback?: Snippet;
	}

	let { of, placeholder, children, __og = NO_SETTINGS, __props, ogygiaFallback }: Props = $props();

	const rp: RegionPlan = new RegionPlan(
		untrack(() => __og),
		() => of,
		() => __og.baked ?? false,
		untrack(() => !!placeholder || !!children),
		(): string => island!.wake.on
	);
	const plan = rp.plan;
	const island: IslandWire | null =
		plan.family === 'island'
			? new IslandWire(
					rp,
					() => __props,
					() => children
				)
			: null;
	if (import.meta.env?.SSR ?? typeof window === 'undefined')
		untrack(() => new PageSeedAsk(rp, island).record());
	const graph =
		(import.meta.env?.SSR ?? typeof window === 'undefined') && island
			? new IslandGraph(rp, island)
			: null;
	const hole = plan.family === 'hole' ? new HoleFacts(rp, () => __props) : null;
	const head =
		(import.meta.env?.SSR ?? typeof window === 'undefined')
			? new RegionHead(rp, { island, graph, hole })
			: null;

	const live = new LiveValue(rp);
	const baked = live.baked;

	const stringify_devalue = stringify;
	function identity(f: DeferredRegion) {
		try {
			return `${f.id}\0${stringify_devalue(f.props)}`;
		} catch {
			return f.id;
		}
	}
	const held_props_script = $derived.by(() => {
		const f = rp.resolved;
		if (!f || f.kind !== 'deferred' || !f.hydrate || !f.url) return '';
		return props_sidecar('', { text: stringify_devalue(f.props), json: false });
	});
	if (DEVTOOLS && plan.devtools !== 'none') {
		untrack(() => {
			try {
				if (plan.devtools === 'island') island?.record_devtools();
				else if (plan.devtools === 'hole') hole?.record_devtools();
				else
					record_server_event({
						domain: 'server',
						name: 'server.region.rendered',
						fp: '',
						mode: 'lake',
						entry: rp.settings.entry || undefined
					});
				// oxlint-disable-next-line ogygia/no-silent-failures -- a devtools emit never breaks a render; the event is left out of the timeline
			} catch {}
		});
	}
</script>

<svelte:head>{@html head?.html ?? ''}</svelte:head>
{#if island}
	{@const Component = island.component}
	{#if plan.inline}{#if Component}<Component {...island.props_ready}
				>{@render children?.()}</Component
			>{:else if island.late_load}<LateIsland
				load={island.late_load}
				props={island.props_ready!}
				{children}
			/>{/if}{:else if island.skip}<ogygia-region
			entry={island.module_url}
			wake={island.wake.on}
			margin={island.wake.margin || undefined}
			data-ogygia-keep={rp.settings.keep || undefined}
			data-og-fp={island.fp || undefined}
			data-og-skipped
			src={island.src || undefined}
		></ogygia-region>{@html island.props_inline}{:else}<ogygia-region
			entry={island.module_url}
			wake={island.wake.on}
			margin={island.wake.margin || undefined}
			data-ogygia-keep={rp.settings.keep || undefined}
			data-og-fp={island.fp || undefined}
			src={island.src || undefined}><Component {...island.props_body} /></ogygia-region
		><!-- svelte-ignore hydration_html_changed -->{@html island.props_inline}{/if}
{:else if hole}
	<HoleRegion {rp} {hole} props={__props} fallback={ogygiaFallback} />
{:else if plan.family === 'lake'}
	<LakeRegion {rp} props={__props} {children} />
{:else if rp.arm === 'inline'}
	{@const held = rp.resolved as InlineRegion}
	{@const Component = held.component}
	<Component {...held.props}
		>{#if children}{@render children()}{/if}</Component
	>
{:else if rp.arm === 'dual'}
	{@const held = rp.resolved as DualRegion}
	{@const Component = held.component}
	<Component {...held.props}
		>{#if children}{@render children()}{/if}</Component
	>
{:else if rp.arm === 'live' || rp.arm === 'live-baked'}
	{#if rp.arm === 'live-baked'}{@render baked()}{:else}<ogygia-region live {@attach live.attach}
			>{#if placeholder}{@render placeholder()}{:else if children}{@render children()}{/if}</ogygia-region
		>{/if}
{:else if rp.arm === 'deferred'}
	{@const d = rp.resolved as DeferredRegion}
	{#key identity(d)}
		<ogygia-region
			entry={d.module || ''}
			render="defer"
			when="load"
			wake={d.hydrate || undefined}
			hydrate-margin={d.hydrateMargin || undefined}
			endpoint={d.url}
			src={location_of(d.module || '') || undefined}
			>{#if placeholder}{@render placeholder()}{:else if children}{@render children()}{/if}</ogygia-region
		><!-- svelte-ignore hydration_html_changed -->{@html held_props_script}
	{/key}
{:else if rp.arm === 'promise'}
	<PromiseRegion of={of as Promise<RegionValue>} {placeholder} {children} />
{/if}
