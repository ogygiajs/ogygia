<script lang="ts">
	import PageHead from '$lib/PageHead.svelte';

	let { data } = $props();
</script>

<PageHead
	title="Errors and warnings"
	description="Every message ogygia prints in the browser: its code, what it means, and what to do about it."
/>

<main class="shell messages">
	<p class="eyebrow">Reference</p>
	<h1>Errors and warnings</h1>
	<p>
		In development each message prints in full, followed by a link to its page. A production build
		prints only <code>[ogygia]</code> and that link: the wording stays out of your bundle, and the page
		shows the message as it was printed.
	</p>
	<div class="list">
		{#each data.messages as m (m.code)}
			<section>
				<h2 id={m.code}><a href="/e/{m.code}"><code>{m.code}</code></a></h2>
				<span class="kind {m.kind}">{m.kind}</span>
				<p>
					{#each m.summary as run, i (i)}{#if run.code}<code>{run.text}</code
							>{:else}{run.text}{/if}{/each}
				</p>
			</section>
		{/each}
	</div>
</main>

<style>
	.messages {
		padding-top: 2.5rem;
		padding-bottom: 4rem;
		max-width: 52rem;
	}
	.list {
		display: grid;
		gap: 1.25rem;
	}
	h2 {
		display: inline;
		margin: 0;
		font-size: 1rem;
		font-weight: inherit;
		line-height: inherit;
		scroll-margin-top: 1.5rem;
	}
	section p {
		margin: 0.25rem 0 0;
	}
	.kind {
		font-size: 0.75rem;
		margin-left: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.7;
	}
	.kind.error {
		color: var(--danger, #c0392b);
	}
</style>
