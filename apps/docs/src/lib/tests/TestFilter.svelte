<script lang="ts">
	// The search and filters over a package's test grid. The grid itself is server HTML (the
	// children); this region only shows or hides its rows, so every test is there with no JavaScript.
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { ENGINES, KINDS } from './data';

	let { total, children }: { total: number; children: Snippet } = $props();

	let root: HTMLElement;
	let ready = $state(false);
	let q = $state('');
	let kind = $state('');
	let engine = $state('');
	let failing = $state(false);
	// How many rows a filter left showing; null until one is applied.
	let shown = $state<number | null>(null);

	onMount(() => {
		ready = true;
	});

	function apply() {
		const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
		let n = 0;
		for (const group of root.querySelectorAll<HTMLElement>('tbody[data-file]')) {
			let any = false;
			const file = (group.dataset.file ?? '').toLowerCase();
			for (const row of group.querySelectorAll<HTMLTableRowElement>('tr[data-kind]')) {
				const d = row.dataset;
				const text = `${row.cells[0].textContent ?? ''} ${file}`.toLowerCase();
				const fails = (d.fail ?? '').split(' ');
				const hit =
					(!kind || (d.kind ?? '').split(' ').includes(kind)) &&
					(!engine || (d.run ?? '').split(' ').includes(engine)) &&
					(!failing || (engine ? fails.includes(engine) : d.fail !== undefined)) &&
					words.every((w) => text.includes(w));
				row.hidden = !hit;
				if (hit) n++;
				any ||= hit;
			}
			group.hidden = !any;
		}
		shown = n;
	}
</script>

<div class="filter" bind:this={root}>
	<form
		class="controls"
		role="search"
		aria-label="Filter tests"
		oninput={apply}
		onchange={apply}
		onsubmit={(e) => e.preventDefault()}
	>
		<label class="q">
			<span>Search</span>
			<input type="search" placeholder="Test name or file" bind:value={q} disabled={!ready} />
		</label>
		<label>
			<span>Kind</span>
			<select bind:value={kind} disabled={!ready}>
				<option value="">All kinds</option>
				{#each KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
			</select>
		</label>
		<label>
			<span>Engine</span>
			<select bind:value={engine} disabled={!ready}>
				<option value="">All engines</option>
				{#each ENGINES as e (e.id)}<option value={e.id}>{e.label}</option>{/each}
			</select>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={failing} disabled={!ready} />
			<span>Failing only</span>
		</label>
	</form>
	<p class="count" aria-live="polite">
		{#if shown === null || shown === total}{total} tests{:else}{shown} of {total} tests{/if}
	</p>
	{@render children()}
</div>

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem 1rem;
		margin: 0 0 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font: 500 0.75rem/1 var(--font-mono);
		color: var(--text-faint);
	}
	.q {
		flex: 1 1 14rem;
	}
	input[type='search'],
	select {
		box-sizing: border-box;
		height: 38px;
		padding: 0 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-sm);
		background: var(--bg-raised);
		color: var(--text);
		font: 400 0.875rem/1 var(--font-body);
	}
	input[type='search'] {
		width: 100%;
	}
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: 0.45rem;
		height: 38px;
		font: 400 0.875rem/1 var(--font-body);
		color: var(--text);
	}
	.check input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--accent);
	}
	:disabled {
		opacity: 0.6;
	}
	.count {
		margin: 0 0 0.75rem;
		font: 400 0.8125rem/1.4 var(--font-mono);
		color: var(--text-faint);
	}
</style>
