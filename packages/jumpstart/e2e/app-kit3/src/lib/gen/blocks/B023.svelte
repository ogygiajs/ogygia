<script>
	import U009 from '../ui/U009.svelte';
	import U017 from '../ui/U017.svelte';
	import I004 from '../icons/I004.svelte';
	import I015 from '../icons/I015.svelte';
	import I053 from '../icons/I053.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b23" data-block="B023">
	<header>
		<I004 label="b4" />
		<I015 label="b15" />
		<I053 label="b53" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U009 {item} />
				<U017 {item} />
			</li>
		{/each}
	</ul>
</section>
