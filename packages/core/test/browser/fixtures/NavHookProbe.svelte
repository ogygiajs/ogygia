<script lang="ts">
	import { bind_to_component } from '../../../src/runtime/nav-hooks.ts';

	let { off }: { off: () => void } = $props();
	// svelte-ignore state_referenced_locally
	bind_to_component(off);
</script>

<p>probe</p>
