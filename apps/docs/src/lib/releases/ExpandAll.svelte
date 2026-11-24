<script lang="ts">
	import { Button } from 'bits-ui';
	// The Releases page's one island: expand all and collapse all over the version cards. On its first
	// run it folds all but the newest few (the server sends every card open, which is what a page
	// without JavaScript keeps). A short list stays open.
	const OPEN = 3;

	function cards(): HTMLDetailsElement[] {
		return [...document.querySelectorAll<HTMLDetailsElement>('details[data-release-version]')];
	}
	function set(open: boolean) {
		for (const d of cards()) d.open = open;
	}
	function fold_older(node: HTMLElement) {
		node.hidden = false; // (hidden in the server's HTML: without JavaScript there is nothing to fold)
		const all = cards();
		if (all.length > OPEN * 2) all.forEach((d, i) => (d.open = i < OPEN));
	}
</script>

<span class="expand" hidden {@attach fold_older}>
	<Button.Root class="btn btn--ghost btn--sm" onclick={() => set(true)}>Expand all</Button.Root>
	<Button.Root class="btn btn--ghost btn--sm" onclick={() => set(false)}>Collapse all</Button.Root>
</span>

<style>
	.expand {
		display: inline-flex;
		gap: 0.5rem;
		margin-left: auto;
	}
	/* (an author `display` beats the browser's own `[hidden]` rule: without JavaScript, stay hidden) */
	.expand[hidden] {
		display: none;
	}
</style>
