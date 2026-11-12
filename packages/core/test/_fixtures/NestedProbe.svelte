<script lang="ts">
	// Says how it was rendered: inside an island (`nested_context`, as a hydrate sees it) or as a root.
	import { isNested } from '../../src/nested.ts';
	const nested = isNested();
</script>

<p data-probe>{nested ? 'inside-an-island' : 'as-a-root'}</p>
