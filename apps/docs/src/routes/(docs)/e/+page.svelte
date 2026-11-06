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
	<ul>
		{#each data.messages as m (m.code)}
			<li>
				<a href="/e/{m.code}"><code>{m.code}</code></a>
				<span class="kind {m.kind}">{m.kind}</span>
				<p>
					{#each m.summary as run, i (i)}{#if run.code}<code>{run.text}</code
							>{:else}{run.text}{/if}{/each}
				</p>
			</li>
		{/each}
	</ul>
</main>

<style>
	.messages {
		padding-top: 2.5rem;
		padding-bottom: 4rem;
		max-width: 52rem;
	}
	ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 1.25rem;
	}
	li p {
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
