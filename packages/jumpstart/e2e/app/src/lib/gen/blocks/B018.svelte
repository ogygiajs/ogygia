<script>
	import U012 from '../ui/U012.svelte';
	import U018 from '../ui/U018.svelte';
	import U020 from '../ui/U020.svelte';
	import I004 from '../icons/I004.svelte';
	import I005 from '../icons/I005.svelte';
	import I011 from '../icons/I011.svelte';
	import I051 from '../icons/I051.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b18" data-block="B018">
	<header>
		<I004 label="b4" />
		<I005 label="b5" />
		<I011 label="b11" />
		<I051 label="b51" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U012 {item} />
				<U018 {item} />
				<U020 {item} />
			</li>
		{/each}
	</ul>
</section>
