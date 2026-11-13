<!-- The same region imports as /csr-true-regions writes in its page file, in a shared component:
     e2e/csr-true-regions.spec.ts checks both behave alike. -->
<script lang="ts">
	import Greeting from '$lib/Greeting.svelte' with { render: 'deferred' };
	import LakeBody from './LakeBody.svelte' with { wake: 'none' };
</script>

<div data-ctr-hole="shared">
	<Greeting salutation="Shared">
		{#snippet ogygiaFallback()}<p data-ctr-fallback="shared">loading…</p>{/snippet}
	</Greeting>
</div>
<LakeBody tag="shared" />
