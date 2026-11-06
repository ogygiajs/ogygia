<script lang="ts">
	import PageHead from '$lib/PageHead.svelte';

	let { data } = $props();
</script>

<PageHead
	title={data.code}
	description="An ogygia {data.kind}: what it means and what to do about it."
/>

<main class="shell message">
	<p class="eyebrow">ogygia {data.kind}</p>
	<h1><code>{data.code}</code></h1>
	<pre>{data.text}</pre>
	{#each data.details as paragraph, p (p)}
		<p>
			{#each paragraph as run, i (i)}{#if run.code}<code>{run.text}</code
					>{:else}{run.text}{/if}{/each}
		</p>
	{/each}
	{#if data.args.length}
		<h2>As printed</h2>
		<dl>
			{#each data.args as [name, value] (name)}
				<dt><code>{name}</code></dt>
				<dd>{value}</dd>
			{/each}
		</dl>
	{/if}
	<p><a href="/e">Every error and warning</a></p>
</main>

<style>
	.message {
		padding-top: 2.5rem;
		padding-bottom: 4rem;
		max-width: 52rem;
	}
	pre {
		white-space: pre-wrap;
		padding: 1rem;
		border-radius: 0.5rem;
		background: var(--code-bg, rgba(127, 127, 127, 0.1));
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.25rem 1rem;
	}
	dd {
		margin: 0;
		word-break: break-all;
	}
</style>
