<script>
	import U006 from '../ui/U006.svelte';
	import U029 from '../ui/U029.svelte';
	import I002 from '../icons/I002.svelte';
	import I031 from '../icons/I031.svelte';
	import I044 from '../icons/I044.svelte';
	import I049 from '../icons/I049.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b1" data-block="B001">
	<header>
		<I002 label="b2" />
		<I031 label="b31" />
		<I044 label="b44" />
		<I049 label="b49" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U006 {item} />
				<U029 {item} />
			</li>
		{/each}
	</ul>
</section>
