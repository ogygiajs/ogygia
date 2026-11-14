<script lang="ts">
	import Region from '../../../src/Region.svelte';
	import { og_html_region, type RegionValue } from '../../../src/region.ts';

	let of: RegionValue = $state(og_html_region('<b>one</b>'));
	let mode: 'lake' | undefined = $state(undefined);
	export const swap = (html: string): void => {
		of = og_html_region(html);
	};
	export const to_lake = (): void => {
		mode = 'lake';
	};
</script>

<Region {of} __mode={mode} />
