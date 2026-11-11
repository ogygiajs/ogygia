<script lang="ts">
	// Renders a SiteSlot under a shell context, as a page inside <Shell> would.
	import { set_shell_context, type ShellContext } from '../../src/site/context.ts';
	import SiteSlot from '../../src/site/components/SiteSlot.svelte';

	let {
		ctx,
		tag,
		attrs = {}
	}: { ctx?: ShellContext; tag: string; attrs?: Record<string, unknown> } = $props();

	// svelte-ignore state_referenced_locally
	if (ctx) set_shell_context(ctx);
</script>

<SiteSlot {tag} {...attrs}>slotted</SiteSlot>
