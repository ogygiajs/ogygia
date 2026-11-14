<script>
	import U011 from '../ui/U011.svelte';
	import U018 from '../ui/U018.svelte';
	import U022 from '../ui/U022.svelte';
	import I003 from '../icons/I003.svelte';
	import I023 from '../icons/I023.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b5" data-block="B005">
	<header>
		<I003 label="b3" />
		<I023 label="b23" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U011 {item} />
				<U018 {item} />
				<U022 {item} />
			</li>
		{/each}
	</ul>
</section>
