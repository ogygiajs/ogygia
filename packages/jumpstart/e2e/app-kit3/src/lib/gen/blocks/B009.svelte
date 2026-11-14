<script>
	import U001 from '../ui/U001.svelte';
	import U009 from '../ui/U009.svelte';
	import U013 from '../ui/U013.svelte';
	import I032 from '../icons/I032.svelte';
	import I043 from '../icons/I043.svelte';
	import I051 from '../icons/I051.svelte';
	import I059 from '../icons/I059.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b9" data-block="B009">
	<header>
		<I032 label="b32" />
		<I043 label="b43" />
		<I051 label="b51" />
		<I059 label="b59" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U001 {item} />
				<U009 {item} />
				<U013 {item} />
			</li>
		{/each}
	</ul>
</section>
