<script lang="ts">
	import { Img } from '@ogygia/image';

	const late = import.meta.og.image.glob('../../lib/late/*.png');
</script>

<h1>images added late</h1>
{#each Object.entries(late) as [key, img] (key)}
	<Img of={img} width={80} aspect="2/1" position="top" alt={key} />
{/each}
