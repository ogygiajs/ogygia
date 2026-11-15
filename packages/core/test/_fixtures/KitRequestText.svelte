<script lang="ts">
	import { getContext } from 'svelte';
	import { KIT_REQUEST_CONTEXT } from '../../src/server/kit-context.ts';
	const req = getContext(KIT_REQUEST_CONTEXT) as
		| { event?: { route?: { id?: string } } | null }
		| undefined;
</script>

<p data-kit-request>{req?.event?.route?.id ?? 'NO EVENT'}</p>
