<script lang="ts">
	import { Img } from '@ogygia/image';

	const spinner = import.meta.og.image('../../../lib/images/spinner.gif');
</script>

<h1>a moving image, rendered on request</h1>
<Img of={spinner} width={60} alt="A moving dot" id="motion" />
