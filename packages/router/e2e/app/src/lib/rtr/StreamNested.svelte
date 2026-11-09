<script lang="ts">
	// A LATE REGION THAT HOLDS ANOTHER: the outer promise resolves to this region, and this region
	// hands its own promise to a <Region of>. Baked into the outer's late chunk, the inner one's
	// slot must be filled down the same response too (e2e/stream-page.spec.ts).
	import { Region } from 'ogygia';
	let { data }: { data: { inner: Promise<unknown> } } = $props();
</script>

<section data-stream-outer>
	<h2>the outer late region</h2>
	<Region of={data.inner as never}>
		{#snippet placeholder()}<div data-inner-skeleton>the inner part is on its way…</div>{/snippet}
	</Region>
</section>
