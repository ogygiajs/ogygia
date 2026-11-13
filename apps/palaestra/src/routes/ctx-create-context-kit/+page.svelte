<script lang="ts">
	import { setRoom } from '$lib/room-runtime.js';
	import { SharedCounter } from '$lib/counter-object.svelte.js';
	import RoomLakeHost from '$lib/lakes/RoomLakeHost.svelte';

	setRoom(new SharedCounter('create-context-kit-room', 6));

	let n = $state(0);
</script>

<h1 data-page>createContext on a csr=true page</h1>
<button data-kit-btn onclick={() => n++}>kit:{n}</button>

<RoomLakeHost />
