<script>
	import U003 from '../ui/U003.svelte';
	import U014 from '../ui/U014.svelte';
	import I021 from '../icons/I021.svelte';
	import I028 from '../icons/I028.svelte';
	import I039 from '../icons/I039.svelte';
	import I056 from '../icons/I056.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b22" data-block="B022">
	<header>
		<I021 label="b21" />
		<I028 label="b28" />
		<I039 label="b39" />
		<I056 label="b56" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U003 {item} />
				<U014 {item} />
			</li>
		{/each}
	</ul>
</section>
