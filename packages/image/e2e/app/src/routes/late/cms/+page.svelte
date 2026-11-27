<script lang="ts">
	import { Img } from '@ogygia/image';

	let { data } = $props();
</script>

<h1>a CMS page rendered on request</h1>
<Img of={data.listed} width={300} alt="Listed" id="listed" />
<Img of={data.unlisted} width={300} alt="Unlisted" id="unlisted" />
<Img of={data.huge} width={300} alt="Huge" id="huge" />
<Img of={data.slow} width={300} alt="Slow" id="slow" />
