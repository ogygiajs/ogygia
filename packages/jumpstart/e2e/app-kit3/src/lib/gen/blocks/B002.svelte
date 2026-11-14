<script>
	import U005 from '../ui/U005.svelte';
	import U009 from '../ui/U009.svelte';
	import I006 from '../icons/I006.svelte';
	import I018 from '../icons/I018.svelte';
	import I019 from '../icons/I019.svelte';
	import I038 from '../icons/I038.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b2" data-block="B002">
	<header>
		<I006 label="b6" />
		<I018 label="b18" />
		<I019 label="b19" />
		<I038 label="b38" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U005 {item} />
				<U009 {item} />
			</li>
		{/each}
	</ul>
</section>
