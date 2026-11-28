<script lang="ts">
	import { Img } from '@ogygia/image';

	const hero = import.meta.og.image('../../lib/hero.jpg');
</script>

<h1>about</h1>
<Img of={hero} preset="thumb" alt="Hills, as a thumbnail" id="about-thumb" />
