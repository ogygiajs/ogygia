<script>
	import U004 from '../ui/U004.svelte';
	import U028 from '../ui/U028.svelte';
	import U029 from '../ui/U029.svelte';
	import I014 from '../icons/I014.svelte';
	import I028 from '../icons/I028.svelte';
	import I034 from '../icons/I034.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b17" data-block="B017">
	<header>
		<I014 label="b14" />
		<I028 label="b28" />
		<I034 label="b34" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U004 {item} />
				<U028 {item} />
				<U029 {item} />
			</li>
		{/each}
	</ul>
</section>
