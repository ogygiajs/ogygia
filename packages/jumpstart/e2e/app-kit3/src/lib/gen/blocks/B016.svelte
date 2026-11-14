<script>
	import U002 from '../ui/U002.svelte';
	import U005 from '../ui/U005.svelte';
	import U023 from '../ui/U023.svelte';
	import U027 from '../ui/U027.svelte';
	import I030 from '../icons/I030.svelte';
	import I044 from '../icons/I044.svelte';
	import I046 from '../icons/I046.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b16" data-block="B016">
	<header>
		<I030 label="b30" />
		<I044 label="b44" />
		<I046 label="b46" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U002 {item} />
				<U005 {item} />
				<U023 {item} />
				<U027 {item} />
			</li>
		{/each}
	</ul>
</section>
