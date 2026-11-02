<script lang="ts">
	// The docs section switcher: which package's docs you are reading, and a menu of the others.
	// A disclosure (`<details>`) of plain links, so it opens and navigates before (or without) JS;
	// as an island it adds the keyboard and pointer details: Escape closes and returns focus to the
	// button, the arrow keys (and Home/End) move between the links, a click outside or a pick closes.
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
			// From the closed button, ArrowDown opens the menu on its current item.
			if (e.key === 'ArrowDown' && e.target instanceof HTMLElement && e.target.tagName === 'SUMMARY') {
				e.preventDefault();
				root!.open = true;
				requestAnimationFrame(() => (links().find((a) => a.hasAttribute('aria-current')) ?? links()[0])?.focus());
			}
			return;
		}
		const list = links();
		const at = list.indexOf(document.activeElement as HTMLAnchorElement);
		let next = -1;
		if (e.key === 'Escape') {
			e.preventDefault();
			close(true);
			return;
		}
		if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % list.length;
		else if (e.key === 'ArrowUp') next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length;
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
	<summary class="sec-sw-trigger" aria-label="Docs section: {here.name}. Switch package">
		<span class="sec-sw-name">{here.name}</span>
		<svg
			class="sec-sw-caret"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2.4"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg
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
		position: relative;
	}
	.sec-sw-trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		height: 1.9rem;
		padding: 0 0.6rem 0 0.65rem;
		border: 1px solid color-mix(in srgb, var(--accent-line) 55%, var(--line));
		border-radius: var(--r-sm);
		background: color-mix(in srgb, var(--bg-raised) 70%, transparent);
		color: var(--text);
		font: 500 0.8125rem/1 var(--font-mono);
		letter-spacing: -0.01em;
		cursor: pointer;
		list-style: none;
		user-select: none;
		white-space: nowrap;
		transition:
			border-color 120ms ease,
			background 120ms ease;
	}
	.sec-sw-trigger::-webkit-details-marker {
		display: none;
	}
	.sec-sw-trigger:hover,
	.sec-sw[open] .sec-sw-trigger {
		border-color: var(--accent-line);
		background: color-mix(in srgb, var(--accent-deep) 45%, var(--bg-raised));
	}
	.sec-sw-trigger:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.sec-sw-caret {
		color: var(--text-dim);
		transition: transform 140ms ease;
	}
	.sec-sw[open] .sec-sw-caret {
		transform: rotate(180deg);
	}
	.sec-sw-menu {
		position: absolute;
		top: calc(100% + 0.45rem);
		left: 0;
		z-index: 70;
		width: min(22rem, calc(100vw - 2rem));
		max-height: calc(100dvh - 5rem);
		overflow-y: auto;
		padding: 0.35rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg-raised);
		box-shadow: var(--shadow-panel);
	}
	.sec-sw-menu ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.sec-sw-sep {
		margin: 0.35rem 0.25rem 0.2rem;
		padding: 0.55rem 0.4rem 0.2rem;
		border-top: 1px solid var(--line);
		color: var(--text-faint);
		font: 600 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.sec-sw-item {
		display: grid;
		gap: 0.2rem;
		padding: 0.5rem 0.65rem;
		border-radius: var(--r-sm);
		color: var(--text-dim);
		text-decoration: none;
	}
	.sec-sw-item:hover,
	.sec-sw-item:focus-visible {
		background: color-mix(in srgb, var(--accent-deep) 42%, transparent);
		color: var(--text);
		outline: none;
	}
	.sec-sw-item:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.sec-sw-item[aria-current='true'] {
		background: color-mix(in srgb, var(--accent-deep) 78%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-line) 45%, transparent);
		color: var(--text);
	}
	.sec-sw-item[aria-current='true']:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.sec-sw-item-name {
		font: 500 0.8125rem/1.2 var(--font-mono);
		color: var(--text);
	}
	.sec-sw-item[aria-current='true'] .sec-sw-item-name {
		color: var(--accent);
	}
	.sec-sw-item-blurb {
		font: 400 0.8125rem/1.35 var(--font-body);
	}
	@media (max-width: 720px) {
		.sec-sw-trigger {
			font-size: 0.75rem;
			padding: 0 0.5rem 0 0.55rem;
		}
		/* On a phone the menu spans the screen under the header, with the page's 1rem gutters (the
		   header is the containing block: it spans the viewport). */
		.sec-sw-menu {
			position: fixed;
			top: 3.85rem;
			left: 1rem;
			right: 1rem;
			width: auto;
			max-height: calc(100dvh - 9rem);
		}
	}
</style>
