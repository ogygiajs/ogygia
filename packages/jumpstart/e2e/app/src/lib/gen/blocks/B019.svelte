<script>
	import U009 from '../ui/U009.svelte';
	import U010 from '../ui/U010.svelte';
	import U019 from '../ui/U019.svelte';
	import U024 from '../ui/U024.svelte';
	import I008 from '../icons/I008.svelte';
	import I028 from '../icons/I028.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b19" data-block="B019">
	<header>
		<I008 label="b8" />
		<I028 label="b28" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U009 {item} />
				<U010 {item} />
				<U019 {item} />
				<U024 {item} />
			</li>
		{/each}
	</ul>
</section>
