<script>
	import U001 from '../ui/U001.svelte';
	import U003 from '../ui/U003.svelte';
	import U029 from '../ui/U029.svelte';
	import I010 from '../icons/I010.svelte';
	import I030 from '../icons/I030.svelte';
	import I048 from '../icons/I048.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b20" data-block="B020">
	<header>
		<I010 label="b10" />
		<I030 label="b30" />
		<I048 label="b48" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U001 {item} />
				<U003 {item} />
				<U029 {item} />
			</li>
		{/each}
	</ul>
</section>
