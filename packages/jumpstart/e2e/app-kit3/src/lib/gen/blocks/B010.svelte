<script>
	import U010 from '../ui/U010.svelte';
	import U023 from '../ui/U023.svelte';
	import U024 from '../ui/U024.svelte';
	import U025 from '../ui/U025.svelte';
	import I018 from '../icons/I018.svelte';
	import I019 from '../icons/I019.svelte';
	import I041 from '../icons/I041.svelte';
	import I042 from '../icons/I042.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b10" data-block="B010">
	<header>
		<I018 label="b18" />
		<I019 label="b19" />
		<I041 label="b41" />
		<I042 label="b42" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U010 {item} />
				<U023 {item} />
				<U024 {item} />
				<U025 {item} />
			</li>
		{/each}
	</ul>
</section>
