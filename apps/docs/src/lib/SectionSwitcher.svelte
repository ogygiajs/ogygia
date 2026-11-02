<script lang="ts">
	// The docs section switcher, at the top of the sidebar (and of the phone's nav sheet): which
	// package's docs you are reading, and a popover menu of the others. Built on Bits UI
	// `DropdownMenu`, like the content shell's version switcher: focus, Escape, outside click, the
	// arrow keys and typeahead come from it. Each item is a real `<a href>` (Bits' `child` snippet),
	// so a pick is a link navigation: middle-click, prefetch and the SPA router all work as links.
	// Interactive, so the layout imports it as an island (`wake: 'load'`); it re-hydrates per nav.
	import { DropdownMenu } from 'bits-ui';
	import { SECTIONS } from '#lib/sections.ts';

	let { current = '' }: { current?: string } = $props();

	const here = $derived(SECTIONS.find((s) => s.key === current) ?? SECTIONS[0]);
	const packages = SECTIONS.slice(1);
</script>

{#snippet item(s: (typeof SECTIONS)[number])}
	<DropdownMenu.Item>
		{#snippet child({ props })}
			<a
				{...props}
				class="sec-sw-item"
				href={s.home}
				aria-current={s.key === here.key ? 'true' : undefined}
			>
				<span class="sec-sw-item-name">{s.name}</span>
				<span class="sec-sw-item-blurb">{s.blurb}</span>
			</a>
		{/snippet}
	</DropdownMenu.Item>
{/snippet}

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="sec-sw-trigger"
		aria-label="Docs section: {here.name}. Switch section"
	>
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
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			class="sec-sw-menu"
			side="bottom"
			align="start"
			sideOffset={6}
			collisionPadding={16}
			aria-label="Docs sections"
		>
			{@render item(SECTIONS[0])}
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading class="sec-sw-sep">Packages</DropdownMenu.GroupHeading>
				{#each packages as s (s.key)}{@render item(s)}{/each}
			</DropdownMenu.Group>
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

<style>
	/* Global: Bits renders the trigger and the (portaled) content, so they carry no scope class. */
	/* The closed row: the sidebar's active-row material (the accent-deep chip with its inset
	   hairline), so it reads as part of the nav, with a two-line label like the menu's items. */
	:global(.sec-sw-trigger) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.55rem 0.5rem 0.7rem;
		border: 0;
		border-radius: 8px;
		background: color-mix(in srgb, var(--accent-deep) 55%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-line) 55%, transparent);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 140ms ease;
	}
	:global(.sec-sw-trigger:hover),
	:global(.sec-sw-trigger[data-state='open']) {
		background: color-mix(in srgb, var(--accent-deep) 80%, transparent);
	}
	:global(.sec-sw-trigger:focus-visible) {
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
	/* The popover: anchored under the row, at least as wide as it, floating over the nav tree on the
	   site's raised panel surface. It never leaves the screen (16px clear of the edges, the height
	   Bits measures as available) and scrolls inside itself when that is short. */
	:global(.sec-sw-menu) {
		z-index: 70;
		box-sizing: border-box;
		width: min(max(var(--bits-floating-anchor-width), 15rem), calc(100vw - 2rem));
		max-height: min(34rem, calc(var(--bits-floating-available-height) - 0.5rem));
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0.3rem;
		border: 1px solid var(--line-strong);
		border-radius: 10px;
		background: var(--bg-raised);
		box-shadow:
			var(--shadow-panel),
			0 18px 40px -22px color-mix(in srgb, var(--accent-deep) 60%, rgba(0, 0, 0, 0.45));
		outline: none;
	}
	/* Phone: the menu opens from the nav sheet; keep its bottom clear of the bottom bar. */
	@media (max-width: 900px) {
		:global(.sec-sw-menu) {
			max-height: min(
				34rem,
				calc(var(--bits-floating-available-height) - var(--og-bar-h, 3.5rem) - 0.5rem)
			);
		}
	}
	:global(.sec-sw-sep) {
		margin: 0.3rem 0.2rem 0.1rem;
		padding: 0.55rem 0.45rem 0.25rem;
		border-top: 1px solid color-mix(in srgb, var(--accent-line) 35%, var(--line));
		color: var(--text-dim);
		font: 600 0.6875rem/1 var(--font-mono);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	/* Each item is a nav row: the same radius, padding, hover and active chip as the tree. Bits
	   marks the keyboard-highlighted one with data-highlighted. */
	.sec-sw-item {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
		margin-top: 0.1rem;
		padding: 0.4rem 0.55rem 0.4rem 0.6rem;
		border-radius: 8px;
		color: var(--text-dim);
		text-decoration: none;
		outline: none;
		transition:
			color 140ms ease,
			background 140ms ease;
	}
	.sec-sw-item:hover,
	.sec-sw-item:global([data-highlighted]) {
		background: color-mix(in srgb, var(--accent-deep) 42%, transparent);
		color: var(--text);
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
