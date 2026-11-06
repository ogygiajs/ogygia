<script lang="ts">
	// Records what an island sees of the "inside an island" context as it hydrates.
	import { isNested } from '../../../src/nested.ts';
	(globalThis as { __og_nested_seen?: boolean[] }).__og_nested_seen?.push(isNested());
</script>

<p>probe</p>
