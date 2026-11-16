<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import { KIT_REQUEST_CONTEXT } from '../../src/server/kit-context.ts';
	let { children }: { children?: Snippet } = $props();
	setContext(KIT_REQUEST_CONTEXT, { page: {}, event: { below: true } });
</script>

{@render children?.()}
