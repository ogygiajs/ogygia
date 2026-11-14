<script>
	import U017 from '../ui/U017.svelte';
	import U021 from '../ui/U021.svelte';
	import U025 from '../ui/U025.svelte';
	import U026 from '../ui/U026.svelte';
	import I011 from '../icons/I011.svelte';
	import I012 from '../icons/I012.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b7" data-block="B007">
	<header>
		<I011 label="b11" />
		<I012 label="b12" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U017 {item} />
				<U021 {item} />
				<U025 {item} />
				<U026 {item} />
			</li>
		{/each}
	</ul>
</section>
