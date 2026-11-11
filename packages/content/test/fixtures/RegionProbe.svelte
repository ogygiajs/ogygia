<script lang="ts">
	import { get_shell_context } from '../../src/site/context.ts';
	import type { Site } from '../../src/site/site.ts';

	let { site }: { site: Site } = $props();
	const ctx = get_shell_context();
</script>

<span class="probe" data-base={ctx?.base} data-same-site={ctx?.site === site}>region</span>
