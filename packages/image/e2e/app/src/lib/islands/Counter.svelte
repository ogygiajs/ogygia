<script lang="ts">
	import { Img } from '@ogygia/image';

	const dot = import.meta.og.image('../images/avatar.jpg');
	let n = $state(0);
</script>

<div id="island">
	<Img
		of={dot}
		layout="fixed"
		width={48}
		alt="An avatar in an island"
		id="island-img"
		class={n % 2 ? 'odd' : 'even'}
	/>
	<button type="button" id="island-count" onclick={() => n++}>{n}</button>
</div>
