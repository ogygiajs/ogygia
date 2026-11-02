<script lang="ts">
	// The docs section switcher, at the top of the sidebar (and of the phone's nav sheet): which
	// package's docs you are reading, and the list of the others. A disclosure (`<details>`) of plain
	// links that opens in place, so it opens and navigates before (or without) JS. As an island it
	// adds the keyboard and pointer details: Escape closes and returns focus to the button, the arrow
	// keys (and Home/End) move between the links, a click outside or a pick closes.
	import { SECTIONS } from '$lib/sections';

	let { current = '' }: { current?: string } = $props();

	const here = $derived(SECTIONS.find((s) => s.key === current) ?? SECTIONS[0]);

	let root: HTMLDetailsElement | null = $state(null);
	let open = $state(false);

	function links(): HTMLAnchorElement[] {
		return root ? [...root.querySelectorAll<HTMLAnchorElement>('.sec-sw-item')] : [];
	}

	function close(refocus: boolean) {
		if (!root) return;
		root.open = false;
		if (refocus) root.querySelector<HTMLElement>('summary')?.focus();
	}

	// The menu's keys, attached to the whole disclosure (the summary and every link inside it).
	function keys(node: HTMLElement) {
		node.addEventListener('keydown', onkeydown);
		return () => node.removeEventListener('keydown', onkeydown);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!root?.open) {
			// From the closed button, ArrowDown opens the list on its current item.
			if (
				e.key === 'ArrowDown' &&
				e.target instanceof HTMLElement &&
				e.target.tagName === 'SUMMARY'
			) {
				e.preventDefault();
				root!.open = true;
				requestAnimationFrame(() =>
					(links().find((a) => a.hasAttribute('aria-current')) ?? links()[0])?.focus()
				);
			}
			return;
		}
		const list = links();
		const at = list.indexOf(document.activeElement as HTMLAnchorElement);
		let next = -1;
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation(); // in the phone's sheet, Escape closes the list, not the sheet
			close(true);
			return;
		}
		if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % list.length;
		else if (e.key === 'ArrowUp')
			next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = list.length - 1;
		if (next >= 0) {
			e.preventDefault();
			list[next]?.focus();
		}
	}

	$effect(() => {
		if (!open) return;
		const away = (e: Event) => {
			if (root && !root.contains(e.target as Node)) close(false);
		};
		document.addEventListener('pointerdown', away);
		document.addEventListener('focusin', away);
		return () => {
			document.removeEventListener('pointerdown', away);
			document.removeEventListener('focusin', away);
		};
	});
</script>

<details class="sec-sw" bind:this={root} bind:open {@attach keys}>
	<summary class="sec-sw-trigger" aria-label="Docs section: {here.name}. Switch section">
		<span class="sec-sw-text">
			<span class="sec-sw-name">{here.name}</span>
			<span class="sec-sw-blurb">{here.blurb}</span>
		</span>
		<svg
			class="sec-sw-caret"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" /></svg
		>
	</summary>
	<nav class="sec-sw-menu" aria-label="Docs sections">
		<ul>
			{#each SECTIONS as s, i (s.name)}
				{#if i === 1}<li class="sec-sw-sep">Packages</li>{/if}
				<li>
					<a
						class="sec-sw-item"
						href={s.home}
						aria-current={s.key === here.key ? 'true' : undefined}
						onclick={() => close(false)}
					>
						<span class="sec-sw-item-name">{s.name}</span>
						<span class="sec-sw-item-blurb">{s.blurb}</span>
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</details>

<style>
	.sec-sw {
		flex: 1;
		min-width: 0;
	}
	/* The closed row: the sidebar's active-row material (the accent-deep chip with its inset
	   hairline), so it reads as part of the nav, and a two-line label like the menu's items. */
	.sec-sw-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.55rem 0.5rem 0.7rem;
		border-radius: 8px;
		background: color-mix(in srgb, var(--accent-deep) 55%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-line) 55%, transparent);
		color: var(--text);
		cursor: pointer;
		list-style: none;
		user-select: none;
		transition: background 140ms ease;
	}
	.sec-sw-trigger::-webkit-details-marker {
		display: none;
	}
	.sec-sw-trigger:hover,
	.sec-sw[open] .sec-sw-trigger {
		background: color-mix(in srgb, var(--accent-deep) 80%, transparent);
	}
	.sec-sw-trigger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.sec-sw-text {
		display: grid;
		gap: 0.15rem;
		flex: 1;
		min-width: 0;
	}
	.sec-sw-name {
		font: 600 0.875rem/1.2 var(--font-body);
		letter-spacing: -0.014em;
	}
	.sec-sw-blurb {
		overflow: hidden;
		color: var(--text-dim);
		font: 400 0.75rem/1.3 var(--font-body);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sec-sw-caret {
		flex-shrink: 0;
		color: var(--text-dim);
	}
	/* The list opens in place, under the row, and scrolls on its own when the space is short. */
	.sec-sw-menu {
		max-height: min(34rem, calc(100dvh - 12rem));
		overflow-y: auto;
		margin-top: 0.4rem;
		padding: 0.3rem;
		border: 1px solid color-mix(in srgb, var(--accent-line) 45%, var(--line));
		border-radius: 10px;
		background: var(--bg-raised);
	}
	.sec-sw-menu ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.sec-sw-sep {
		margin: 0.3rem 0.2rem 0.1rem;
		padding: 0.55rem 0.45rem 0.25rem;
		border-top: 1px solid color-mix(in srgb, var(--accent-line) 35%, var(--line));
		color: var(--text-dim);
		font: 600 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	/* Each item is a nav row: the same radius, padding, hover and active chip as the tree below. */
	.sec-sw-item {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
		padding: 0.4rem 0.55rem 0.4rem 0.6rem;
		border-radius: 8px;
		color: var(--text-dim);
		text-decoration: none;
		transition:
			color 140ms ease,
			background 140ms ease;
	}
	.sec-sw-item:hover {
		background: color-mix(in srgb, var(--accent-deep) 42%, transparent);
		color: var(--text);
	}
	.sec-sw-item:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.sec-sw-item[aria-current='true'] {
		background: color-mix(in srgb, var(--accent-deep) 78%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-line) 45%, transparent);
		color: var(--text);
	}
	.sec-sw-item-name {
		font: 500 0.84375rem/1.25 var(--font-body);
		letter-spacing: -0.014em;
		color: var(--text);
	}
	.sec-sw-item[aria-current='true'] .sec-sw-item-name {
		font-weight: 600;
	}
	.sec-sw-item-blurb {
		overflow: hidden;
		font: 400 0.75rem/1.3 var(--font-body);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
