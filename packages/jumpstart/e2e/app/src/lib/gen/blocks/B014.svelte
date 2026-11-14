<script>
	import U010 from '../ui/U010.svelte';
	import U027 from '../ui/U027.svelte';
	import U028 from '../ui/U028.svelte';
	import I016 from '../icons/I016.svelte';
	import I023 from '../icons/I023.svelte';
	import I029 from '../icons/I029.svelte';
	import I047 from '../icons/I047.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b14" data-block="B014">
	<header>
		<I016 label="b16" />
		<I023 label="b23" />
		<I029 label="b29" />
		<I047 label="b47" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U010 {item} />
				<U027 {item} />
				<U028 {item} />
			</li>
		{/each}
	</ul>
</section>
