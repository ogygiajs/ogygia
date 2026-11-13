<script lang="ts">
	import { getContext } from 'svelte';

	let { label }: { label: string } = $props();

	const rt = getContext<{ a: number } | undefined>(Symbol.for('rt'));
	const scoped = getContext<{ b: number } | undefined>(Symbol.for('rt-scoped'));
</script>

<span
	class="island"
	data-symctx-reader={label}
	data-symctx-a={rt?.a ?? -1}
	data-symctx-b={scoped?.b ?? -1}>a={rt?.a ?? -1} b={scoped?.b ?? -1}</span
>
