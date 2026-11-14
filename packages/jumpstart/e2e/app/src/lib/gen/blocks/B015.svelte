<script>
	import U010 from '../ui/U010.svelte';
	import U021 from '../ui/U021.svelte';
	import U028 from '../ui/U028.svelte';
	import I037 from '../icons/I037.svelte';
	import I038 from '../icons/I038.svelte';
	import I043 from '../icons/I043.svelte';
	import I044 from '../icons/I044.svelte';

	let { title, items } = $props();
	let open = $state(false);
</script>

<section class="block b15" data-block="B015">
	<header>
		<I037 label="b37" />
		<I038 label="b38" />
		<I043 label="b43" />
		<I044 label="b44" />
		<h2>{title}</h2>
		<button onclick={() => (open = !open)}>{open ? 'less' : 'more'}</button>
	</header>
	<ul>
		{#each items as item, n (n)}
			<li>
				<U010 {item} />
				<U021 {item} />
				<U028 {item} />
			</li>
		{/each}
	</ul>
</section>
