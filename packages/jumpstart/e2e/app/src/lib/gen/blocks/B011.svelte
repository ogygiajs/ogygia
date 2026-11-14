<script>
	import U001 from '../ui/U001.svelte';
	import U010 from '../ui/U010.svelte';
	import U017 from '../ui/U017.svelte';
	import U022 from '../ui/U022.svelte';
	import I014 from '../icons/I014.svelte';
	import I027 from '../icons/I027.svelte';
	import I039 from '../icons/I039.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b11" data-block="B011">
	<header>
		<I014 label="b14" />
		<I027 label="b27" />
		<I039 label="b39" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U001 {item} />
				<U010 {item} />
				<U017 {item} />
				<U022 {item} />
			</li>
		{/each}
	</ul>
</section>
