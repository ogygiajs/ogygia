<script lang="ts">
	// An island holding a nested island beside an `{@html}`: the element around them carries the
	// compiler's `data-og-html` stamp (written here by hand: this suite does not run the compiler),
	// so its child elements may be `{@html}` content. The nested island is not: Svelte's hydration
	// walk binds inside it (#1425).
	import Region from '../../../src/Region.svelte';
	import Counter from './Counter.svelte';
	let { note = '<i>note</i>' }: { note?: string } = $props();
</script>

<div data-og-html data-host>
	<span>outer</span>
	<Region
		__mode="island"
		__entry="/test/browser/fixtures/Counter.svelte"
		__component={Counter}
		__props={{ start: 1 }}
		idle={true}
	/>
	{@html note}
</div>
