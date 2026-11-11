<!--
@component
The previous and next links of a `PageView`'s trail, in a nav that is left out when there are
neither. With only a next link, an empty first cell keeps it in the second place.
-->
<script lang="ts">
	import type { PageView } from '../types.ts';

	let {
		trail,
		previousLabel = 'Previous',
		nextLabel = 'Next'
	}: {
		trail: Pick<PageView['trail'], 'prev' | 'next'>;
		previousLabel?: string;
		nextLabel?: string;
	} = $props();
</script>

{#if trail.prev || trail.next}
	<nav class="og-pager" aria-label="Previous and next page">
		{#if trail.prev}
			<a class="og-pager-link og-pager-prev" href={trail.prev.href} rel="prev">
				<span class="og-pager-dir">{previousLabel}</span>
				<span class="og-pager-title">{trail.prev.title}</span>
			</a>
		{:else}
			<span></span>
		{/if}
		{#if trail.next}
			<a class="og-pager-link og-pager-next" href={trail.next.href} rel="next">
				<span class="og-pager-dir">{nextLabel}</span>
				<span class="og-pager-title">{trail.next.title}</span>
			</a>
		{/if}
	</nav>
{/if}
