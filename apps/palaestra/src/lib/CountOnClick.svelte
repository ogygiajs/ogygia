<script lang="ts">
	import { getCount } from '$lib/greetings.remote';

	let read = $state('');
	async function on_read() {
		read = String(await getCount());
	}
</script>

<div class="island" data-count-on-click>
	<button data-read-count onclick={on_read}>read the count</button>
	<output data-read>{read}</output>
</div>
