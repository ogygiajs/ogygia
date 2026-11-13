<script lang="ts">
	import { setRoom } from '$lib/room-runtime.js';
	import { SharedCounter } from '$lib/counter-object.svelte.js';

	let { children } = $props();

	setRoom(new SharedCounter('create-context-room', 4));
</script>

{@render children()}
