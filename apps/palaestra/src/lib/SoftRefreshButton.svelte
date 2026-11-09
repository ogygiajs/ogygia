<script lang="ts">
	// Calls invalidateAll (the soft seed refresh a remote form runs on success): e2e/router-ownership.spec.ts.
	import { invalidateAll } from '$app/navigation';
	let done = $state(0);
</script>

<button data-soft-refresh onclick={async () => (await invalidateAll(), done++)}>
	refresh ({done})
</button>
