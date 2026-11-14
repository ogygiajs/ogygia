<script>
	import U020 from '../ui/U020.svelte';
	import U021 from '../ui/U021.svelte';
	import U022 from '../ui/U022.svelte';
	import I009 from '../icons/I009.svelte';
	import I037 from '../icons/I037.svelte';
	import I040 from '../icons/I040.svelte';
	import I051 from '../icons/I051.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b0" data-block="B000">
	<header>
		<I009 label="b9" />
		<I037 label="b37" />
		<I040 label="b40" />
		<I051 label="b51" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U020 {item} />
				<U021 {item} />
				<U022 {item} />
			</li>
		{/each}
	</ul>
</section>
