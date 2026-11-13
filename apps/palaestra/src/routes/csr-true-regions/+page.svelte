<!-- A csr=true page whose own file declares a deferred hole, a lake and a wake island, beside a
     shared component that declares the same hole and lake: e2e/csr-true-regions.spec.ts. -->
<script lang="ts">
	import Greeting from '$lib/Greeting.svelte' with { render: 'deferred' };
	import LakeBody from '$lib/csr-true-regions/LakeBody.svelte' with { wake: 'none' };
	import Counter from '$lib/Counter.svelte' with { wake: 'load' };
	import Shared from '$lib/csr-true-regions/Shared.svelte';
	let k = $state(0);
</script>

<button data-ctr-kit onclick={() => k++}>kit:{k}</button>
<div data-ctr-hole="page">
	<Greeting salutation="Page">
		{#snippet ogygiaFallback()}<p data-ctr-fallback="page">loading…</p>{/snippet}
	</Greeting>
</div>
<LakeBody tag="page" />
<div data-ctr-island><Counter start={3} label="kit counter" /></div>
<Shared />
