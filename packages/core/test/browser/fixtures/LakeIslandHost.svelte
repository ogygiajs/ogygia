<script lang="ts">
	import Region from '../../../src/Region.svelte';
</script>

<div data-lake-host>
	<span>outer</span>
	<Region __mode="lake" __entry="lake-island"
		><x-lake-probe data-probe><b>frozen</b></x-lake-probe></Region
	>
</div>
