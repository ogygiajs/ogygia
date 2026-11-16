<script lang="ts">
	import Region from '../../../src/Region.svelte';
</script>

<div data-lake-host>
	<span>outer</span>
	<Region __og={{ mode: 'lake', entry: 'lake-island' }}
		><x-lake-probe data-probe><b>frozen</b></x-lake-probe></Region
	>
</div>
