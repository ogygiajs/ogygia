<script lang="ts">
	import { getRoom, hasRoom } from '$lib/room-runtime.js';

	let { label }: { label: string } = $props();

	const room = hasRoom() ? getRoom() : undefined;
	if (typeof window !== 'undefined' && room) {
		const seen = window as unknown as { __og_rooms?: unknown[] };
		(seen.__og_rooms ??= []).push(room);
	}
</script>

<button class="island" data-room-region={label} onclick={() => room?.inc()}
	>{label}:{room?.count ?? -1}</button
>
