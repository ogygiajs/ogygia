<script lang="ts">
	// Plain links in a disclosure, so picking a version works with no JavaScript.
	let { versions, current, pkg }: { versions: string[]; current: string; pkg?: string } = $props();
</script>

<details class="picker">
	<summary>
		<span class="label">Version</span>
		<span class="value">{current}</span>
		{#if versions[0] === current}<span class="latest">latest</span>{/if}
	</summary>
	<ul>
		{#each versions as v, i (v)}
			<li>
				<a
					href="/tests/{v}{pkg ? `/${pkg}` : ''}"
					aria-current={v === current ? 'page' : undefined}
				>
					{v}{#if i === 0}<span class="latest">latest</span>{/if}
				</a>
			</li>
		{/each}
	</ul>
</details>

<style>
	.picker {
		position: relative;
		display: inline-block;
	}
	summary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 36px;
		padding: 0 0.75rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--bg-raised);
		cursor: pointer;
		list-style: none;
		font: 500 0.8125rem/1 var(--font-mono);
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary::after {
		content: '▾';
		color: var(--text-faint);
	}
	summary:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.label {
		color: var(--text-faint);
	}
	.latest {
		margin-left: 0.4rem;
		padding: 0.15rem 0.35rem;
		border-radius: 4px;
		background: var(--accent-deep);
		color: var(--accent);
		font-size: 0.6875rem;
	}
	ul {
		position: absolute;
		z-index: 5;
		top: calc(100% + 4px);
		left: 0;
		min-width: 100%;
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		padding: 0.25rem;
		list-style: none;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--bg-raised);
		box-shadow: var(--shadow-panel);
	}
	a {
		display: flex;
		align-items: center;
		min-height: 36px;
		padding: 0 0.6rem;
		border-radius: 4px;
		color: var(--text);
		text-decoration: none;
		font: 400 0.8125rem/1 var(--font-mono);
		white-space: nowrap;
	}
	a:hover,
	a:focus-visible {
		background: var(--bg-sunken);
	}
	a[aria-current='page'] {
		color: var(--accent);
	}
</style>
