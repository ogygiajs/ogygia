<script>
	import U011 from '../ui/U011.svelte';
	import U015 from '../ui/U015.svelte';
	import U018 from '../ui/U018.svelte';
	import U029 from '../ui/U029.svelte';
	import I016 from '../icons/I016.svelte';
	import I022 from '../icons/I022.svelte';
	import I039 from '../icons/I039.svelte';
	import I045 from '../icons/I045.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b4" data-block="B004">
	<header>
		<I016 label="b16" />
		<I022 label="b22" />
		<I039 label="b39" />
		<I045 label="b45" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U011 {item} />
				<U015 {item} />
				<U018 {item} />
				<U029 {item} />
			</li>
		{/each}
	</ul>
</section>
