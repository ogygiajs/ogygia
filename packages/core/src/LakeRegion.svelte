<!--
@component
A lake region: server HTML that never wakes. In a csr page, or inside an island, the browser adopts
the element the server wrote; elsewhere it renders its children in place.
-->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { make_region_endpoint } from '#region-server';
	import { lake_identity } from './server/props-wire.ts';
	import { escape_attr } from './escape.ts';
	import { warn } from './messages/island.ts';
	import { adopt_region } from './region-parts/adopt.ts';
	import type { RegionPlan } from './region-parts/plan.svelte.ts';
	import LakeBoundary from './LakeBoundary.svelte';

	interface Props {
		rp: RegionPlan;
		props?: Record<string, unknown>;
		children?: Snippet;
	}

	let { rp, props, children }: Props = $props();
	const s = untrack(() => rp.settings);
	const entry = s.entry ?? '';
	const remount = s.remount ?? 'cache';
	const swr = remount === 'swr';
	const endpoint = $derived(
		rp.plan.lake_inside && swr ? make_region_endpoint(entry, props || {}) : ''
	);
	const attrs = $derived.by(() => {
		const esc = (v: unknown) => escape_attr(String(v));
		const identity = lake_identity(entry, props);
		return ` entry="${esc(entry)}" wake="none" remount="${esc(remount)}"${identity ? ` data-og-lake="${identity}"` : ''}${swr ? ` when="${esc(s.when ?? 'load')}"` : ''}${s.maxAge != null ? ` max-age="${esc(String(s.maxAge))}"` : ''}${s.onExpire ? ` on-expire="${esc(s.onExpire)}"` : ''}${swr && s.margin ? ` margin="${esc(s.margin)}"` : ''}${endpoint ? ` endpoint="${esc(endpoint)}"` : ''}`;
	});
	const adopt = adopt_region(
		() => attrs,
		(renderer) => LakeBoundary(renderer, { children } as never),
		(el) => {
			if (rp.plan.csr && !el.firstChild && import.meta.env && import.meta.env.DEV)
				warn('lake_mounted_without_html', { entry });
		}
	);
</script>

{#if rp.plan.arm === 'lake-adopt'}{@render adopt()}{:else}
	{@render children?.()}
{/if}
