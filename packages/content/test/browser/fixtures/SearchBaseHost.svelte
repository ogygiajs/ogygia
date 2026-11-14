<script lang="ts">
	import Search from '../../../src/site/components/Search.svelte';
	import type { SearchHit } from '../../../src/site/search.ts';

	let base = $state('/v1');
	const query = async (): Promise<SearchHit[]> => [];
	export const move = (next: string): void => {
		base = next;
	};
</script>

<Search {base} {query} />
