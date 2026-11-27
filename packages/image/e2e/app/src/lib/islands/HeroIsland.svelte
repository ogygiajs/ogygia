<script lang="ts">
	import { Img } from '@ogygia/image';

	const hero = import.meta.og.image('../images/hero.jpg');
	let n = $state(0);
</script>

<div id="hero-island">
	<Img
		of={hero}
		preset="cover"
		alt="Hills, in an island"
		id="island-hero"
		class={n % 2 ? 'odd' : 'even'}
	/>
	<button type="button" id="hero-count" onclick={() => n++}>{n}</button>
</div>
