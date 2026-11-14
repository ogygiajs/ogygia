<script>
	import U002 from '../ui/U002.svelte';
	import U004 from '../ui/U004.svelte';
	import U007 from '../ui/U007.svelte';
	import U021 from '../ui/U021.svelte';
	import I000 from '../icons/I000.svelte';
	import I042 from '../icons/I042.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b3" data-block="B003">
	<header>
		<I000 label="b0" />
		<I042 label="b42" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U002 {item} />
				<U004 {item} />
				<U007 {item} />
				<U021 {item} />
			</li>
		{/each}
	</ul>
</section>
