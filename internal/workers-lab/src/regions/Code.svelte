<script lang="ts">
	import { highlight } from '../highlight.ts';

	let { title, source }: { title: string; source: string } = $props();
	const html = $derived(highlight(source));
	const lines = $derived(source.split('\n').length);
</script>

<section class="code">
	<header>
		<h2>{title}</h2>
		<span>{lines} lines</span>
	</header>
	{@html html}
</section>
