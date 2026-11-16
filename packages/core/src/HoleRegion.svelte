<!--
@component
A hole region: an `<ogygia-region>` its endpoint fills. Inside an island it is frozen with its server
HTML; in a csr page or a live snippet the browser adopts the element the server wrote; elsewhere it
renders its shell with its fallback.
-->
<script lang="ts">
	import { mount, unmount, untrack, type Snippet } from 'svelte';
	import { lake_identity } from './server/props-wire.ts';
	import { escape_attr } from './escape.ts';
	import { adopt_region } from './region-parts/adopt.ts';
	import type { HoleFacts } from './region-parts/hole-facts.svelte.ts';
	import type { RegionPlan } from './region-parts/plan.svelte.ts';
	import LakeBoundary from './LakeBoundary.svelte';
	import SlotBoundary from './SlotBoundary.svelte';

	interface Props {
		rp: RegionPlan;
		hole: HoleFacts;
		props?: Record<string, unknown>;
		fallback?: Snippet;
	}

	let { rp, hole, props, fallback }: Props = $props();
	const s = untrack(() => rp.settings);
	const adopt = adopt_region(
		() => hole.attrs(),
		(renderer) => {
			if (fallback) SlotBoundary(renderer, { children: fallback } as never);
		},
		(el, hydrated) => {
			if (hydrated) hole.adopted(el);
			if (el.firstChild || !fallback) return;
			const app = mount(SlotBoundary, { target: el, props: { children: fallback } });
			// oxlint-disable-next-line ogygia/no-silent-failures -- unmount's promise is its outros ending; it never rejects
			return () => void unmount(app);
		}
	);
	const frozen = adopt_region(
		() => {
			const identity = lake_identity(hole.entry, props);
			return ` entry="${escape_attr(hole.entry)}" wake="none" remount="cache"${identity ? ` data-og-lake="${identity}"` : ''}`;
		},
		(renderer) => {
			const Component = s.component as unknown as (r: unknown, p: unknown) => void;
			if (Component)
				LakeBoundary(renderer, {
					children: (r: unknown) => Component(r, props || {})
				} as never);
		}
	);
</script>

{#if rp.plan.arm === 'hole-frozen'}{@render frozen()}{:else if rp.plan.arm === 'hole-adopt'}{@render adopt()}<!-- svelte-ignore hydration_html_changed -->{@html hole.props_script}{:else}<ogygia-region
		entry={hole.entry_url}
		render="defer"
		stitch={s.stitch || undefined}
		prefetch={s.prefetch || undefined}
		when={hole.when}
		wake={hole.wake || undefined}
		margin={s.margin || undefined}
		hydrate-margin={hole.wake_margin || undefined}
		endpoint={hole.endpoint}
		data-og-hole={hole.identity || undefined}
		src={hole.src || undefined}
		>{#if fallback}<SlotBoundary>{@render fallback()}</SlotBoundary>{/if}</ogygia-region
	><!-- svelte-ignore hydration_html_changed -->{@html hole.props_script}{/if}
