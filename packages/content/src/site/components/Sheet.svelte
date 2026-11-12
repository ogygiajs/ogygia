<!--
@component
The bottom sheet: a Bits UI `Dialog` labelled `label` ("Menu" by default) that holds `children`
and, below them, an optional `footer`. `open` is bindable. A press outside closes it, except on a
`data-ph-sheet-toggle` element: that button toggles `open` itself, and closing first would make its
click open the sheet again. Interactive, so import it as an island (`with { wake: 'load' }`).
-->
<script lang="ts">
	import { Dialog } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		label = 'Menu',
		children,
		footer
	}: {
		open?: boolean;
		label?: string;
		children: Snippet;
		footer?: Snippet;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="og-sheet-backdrop" />
		<Dialog.Content
			class="og-sheet"
			aria-label={label}
			onInteractOutside={(e) => {
				const t = e.target;
				if (t instanceof Element && t.closest('[data-ph-sheet-toggle]')) e.preventDefault();
			}}
		>
			<Dialog.Title class="og-sr-only">{label}</Dialog.Title>
			<div class="og-sheet-handle" aria-hidden="true"><span></span></div>
			<div class="og-sheet-body">{@render children()}</div>
			{#if footer}<div class="og-sheet-footer">{@render footer()}</div>{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
