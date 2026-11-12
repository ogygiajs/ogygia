<script lang="ts">
	// a plain component (no region of its own) that holds the inner region
	import { Region } from 'ogygia';
	import { heldInner } from './inner.remote';
</script>

<div data-hih-inner-host><Region of={heldInner()} /></div>
