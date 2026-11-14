<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setNested, setInLake } from './context.ts';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();
	// @why a lake's inside is dead again, so a waking region there emits its own region (test: test/lake-boundary-claims.test.ts › a waking island inside a lake inside an awake island emits its own region)
	setNested(false);
	// @why Kit never hydrates a lake's inside, so its regions stay real on a csr=true document (test: test/lake-kit.test.ts › an island INSIDE the lake keeps its real region)
	setInLake();
</script>

{@render children?.()}
