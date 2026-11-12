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
	<!-- (a long code breaks after an underscore, never mid-word) -->
	<h1>
		<code
			>{#each data.code.split('_') as part, i (i)}{#if i}_<wbr />{/if}{part}{/each}</code
		>
	</h1>
	<pre>{data.text}</pre>
	{#each data.details as paragraph, p (p)}
		<p>
			{#each paragraph as run, i (i)}{#if run.code}<code>{run.text}</code
					>{:else}{run.text}{/if}{/each}
		</p>
	{/each}
	{#if data.args.length}
		<h2>Values in this message</h2>
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
	/* the code is the title: a heading's size, not the small inline-code look (a step under the
	   display h1, which a 25-character mono code would overflow) */
	h1 {
		font-size: clamp(2rem, 5vw, 3.25rem);
	}
	h1 code {
		font-size: inherit;
		line-height: inherit;
		background: none;
		padding: 0;
		overflow-wrap: anywhere;
	}
	pre {
		white-space: pre-wrap;
		padding: 1rem;
		border-radius: 0.5rem;
		background: var(--code-bg, rgba(127, 127, 127, 0.1));
		margin: 2rem 0;
	}
	p:not(.eyebrow) {
		margin: 0 0 1.25rem;
	}
	/* a section label, like the eyebrow: the values are a detail of the message, not a new part */
	h2 {
		margin: 2.5rem 0 0.75rem;
		font: 500 0.75rem/1.2 var(--font-mono);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-faint);
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.5rem 1rem;
		margin: 0 0 2.5rem;
	}
	dd {
		margin: 0;
		word-break: break-all;
	}
</style>
