<script>
	import U000 from '../ui/U000.svelte';
	import U008 from '../ui/U008.svelte';
	import U014 from '../ui/U014.svelte';
	import U017 from '../ui/U017.svelte';
	import I003 from '../icons/I003.svelte';
	import I024 from '../icons/I024.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b12" data-block="B012">
	<header>
		<I003 label="b3" />
		<I024 label="b24" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U000 {item} />
				<U008 {item} />
				<U014 {item} />
				<U017 {item} />
			</li>
		{/each}
	</ul>
</section>
