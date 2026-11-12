<script lang="ts">
	// The report's own definition is exact but dense; the plain line says it first.
	let { definition }: { definition?: string } = $props();
</script>

{#if definition}
	<span class="how-counted">
		Only real test code counts: test files and their helpers, not fixtures, sample apps or benches.
		Blank lines are left out on both sides.
	</span>
	<details class="how-counted">
		<summary>Exactly what is counted</summary>
		{definition}
	</details>
{/if}
