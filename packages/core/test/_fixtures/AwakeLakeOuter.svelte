<script>
	// An awake island's template that holds a lake, which holds a `wake: 'load'` island.
	import Region from '../../src/Region.svelte';
	import LakeKitInner from './LakeKitInner.svelte';
</script>

<Region __mode="lake" __entry="lake-in-island"><LakeKitInner /></Region>
