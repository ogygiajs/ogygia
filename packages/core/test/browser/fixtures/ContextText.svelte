<script lang="ts">
	import { getContext } from 'svelte';

	const probe = getContext<string>('probe');
</script>

<p>{probe}</p>
