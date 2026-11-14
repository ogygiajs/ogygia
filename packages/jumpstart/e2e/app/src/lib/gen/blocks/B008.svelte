<script>
	import U004 from '../ui/U004.svelte';
	import U011 from '../ui/U011.svelte';
	import U013 from '../ui/U013.svelte';
	import I000 from '../icons/I000.svelte';
	import I038 from '../icons/I038.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b8" data-block="B008">
	<header>
		<I000 label="b0" />
		<I038 label="b38" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U004 {item} />
				<U011 {item} />
				<U013 {item} />
			</li>
		{/each}
	</ul>
</section>
