<script>
	import U004 from '../ui/U004.svelte';
	import U022 from '../ui/U022.svelte';
	import I005 from '../icons/I005.svelte';
	import I020 from '../icons/I020.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b6" data-block="B006">
	<header>
		<I005 label="b5" />
		<I020 label="b20" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U004 {item} />
				<U022 {item} />
			</li>
		{/each}
	</ul>
</section>
