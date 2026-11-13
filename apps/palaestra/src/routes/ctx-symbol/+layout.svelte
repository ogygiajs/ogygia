<script lang="ts">
	import { setContext } from 'ogygia';

	let { children } = $props();

	setContext(Symbol.for('rt'), { a: 1 });
</script>

{@render children()}
