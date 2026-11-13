<script lang="ts">
	// `orphan` is never provided anywhere. The read must return the default, never crash, even with
	// no <ogygia-context> above this island in the DOM.
	import { readOrphan } from '$lib/room-context.svelte.js';

	const v = readOrphan();
</script>

<span class="island" data-ctx-orphan>{v}</span>
