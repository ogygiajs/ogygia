<script>
	import U000 from '../ui/U000.svelte';
	import U005 from '../ui/U005.svelte';
	import U017 from '../ui/U017.svelte';
	import U020 from '../ui/U020.svelte';
	import I018 from '../icons/I018.svelte';
	import I026 from '../icons/I026.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b21" data-block="B021">
	<header>
		<I018 label="b18" />
		<I026 label="b26" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U000 {item} />
				<U005 {item} />
				<U017 {item} />
				<U020 {item} />
			</li>
		{/each}
	</ul>
</section>
