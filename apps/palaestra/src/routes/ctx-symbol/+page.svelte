<script lang="ts">
	import { Provide } from 'ogygia';
	import SymCtxReader from '$lib/SymCtxReader.svelte' with { wake: 'load' };
</script>

<h1 data-static-shell>A shared symbol key crosses into regions</h1>

<SymCtxReader label="marker" />
<Provide values={{ [Symbol.for('rt-scoped')]: { b: 2 } }}>
	<SymCtxReader label="provide" />
</Provide>
