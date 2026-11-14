<script>
	import U020 from '../ui/U020.svelte';
	import U022 from '../ui/U022.svelte';
	import I030 from '../icons/I030.svelte';
	import I046 from '../icons/I046.svelte';
	import I054 from '../icons/I054.svelte';
	import I055 from '../icons/I055.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b13" data-block="B013">
	<header>
		<I030 label="b30" />
		<I046 label="b46" />
		<I054 label="b54" />
		<I055 label="b55" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U020 {item} />
				<U022 {item} />
			</li>
		{/each}
	</ul>
</section>
