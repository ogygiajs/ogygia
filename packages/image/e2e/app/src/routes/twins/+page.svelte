<script lang="ts">
	import { Img } from '@ogygia/image';

	const chart = import.meta.og.image('../../lib/images/chart.png', {
		dark: '../../lib/images/chart-dark.png'
	});
	const hero = import.meta.og.image('../../lib/images/hero.jpg');
	const designed = import.meta.og.image('../../lib/images/hero.jpg', {
		art: { '(max-width: 600px)': '../../lib/images/portrait.jpg' }
	});
	const portrait = import.meta.og.image('../../lib/images/portrait.jpg');
	const spinner = import.meta.og.image('../../lib/images/spinner.gif');
</script>

<h1>twins</h1>
<Img of={chart} width={300} alt="A chart" id="chart" />
<Img of={hero} preset="hero" alt="Hills, art-directed by the preset" id="art-preset" />
<Img of={designed} width={400} alt="Hills, art-directed by the macro" id="art-macro" />
<Img
	of={hero}
	width={400}
	art={[{ media: '(max-width: 600px)', of: portrait }]}
	alt="Hills, art-directed by the prop"
	id="art-prop"
/>
<Img of={spinner} width={60} alt="A moving dot" id="motion" />
