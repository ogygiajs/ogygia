<script lang="ts">
	import { Img } from '@ogygia/image';

	let { data } = $props();
</script>

<h1>a CMS page</h1>
<Img of={data.cover} width={400} alt={data.cover.alt!} id="cms" />
