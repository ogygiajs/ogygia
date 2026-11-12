<script lang="ts">
	// a server island inside an island (so it renders inline, as a lake) that holds another one
	import Inner from './Inner.svelte' with { render: 'deferred' };
</script>

<section data-hil-middle>middle <Inner /></section>
