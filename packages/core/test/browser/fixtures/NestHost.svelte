<script lang="ts">
	// An island holding a nested island beside an `{@html}`: the element around them carries the
	// compiler's `data-og-html` stamp and the `{@html}` its range mark (written here by hand: this
	// suite does not run the compiler). The nested island is not in the range: Svelte's hydration
	// walk binds inside it (#1425).
	import Region from '../../../src/Region.svelte';
	import Counter from './Counter.svelte';
	let { note = '<i>note</i>' }: { note?: string } = $props();
</script>

<div data-og-html data-host>
	<span>outer</span>
	<Region
		__og={{
			mode: 'island',
			entry: '/test/browser/fixtures/Counter.svelte',
			component: Counter,
			wake: 'idle'
		}}
		__props={{ start: 1 }}
	/>
	{@html '<!--@html-->' + note}
</div>
