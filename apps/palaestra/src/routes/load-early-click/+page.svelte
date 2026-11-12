<script lang="ts">
	// e2e/load-early-click.spec.ts: clicks on a load-woken island before its code is live count.
	import Counter from '$lib/Counter.svelte' with { wake: 'load' };
	import InteractionCounter from '$lib/InteractionCounter.svelte' with { wake: 'load' };
</script>

<h1 data-static-shell>Early clicks on a load island</h1>

<Counter label="load" start={0} />
<InteractionCounter />
