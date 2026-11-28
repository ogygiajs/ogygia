<script lang="ts">
	import { Img } from '@ogygia/image';

	const hero = import.meta.og.image('../lib/hero.jpg');
</script>

<h1>images</h1>
<a href="/about">About</a>
<Img of={hero} alt="Hills at dusk" id="hero" />
<Img of={hero} preset="thumb" alt="Hills, as a thumbnail" id="thumb" />
