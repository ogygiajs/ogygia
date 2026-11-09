<script lang="ts">
	// A CLASS MODULE THAT FAILS TO DOWNLOAD (e2e/lazy-chunk-retry.spec.ts, #237): two islands carry
	// the same transportable class, which neither imports as a value, so each wake loads its module
	// first. One is in view at load, one far below the fold: a later wake, after a failed first one.
	import StampCounter from '$lib/StampCounter.svelte' with { wake: 'visible' };
	import { RetryStamp } from '$lib/retry-stamp.svelte.ts';

	const stamp = new RetryStamp('kept');
</script>

<h1 data-static-shell>A class module that fails</h1>

<StampCounter {stamp} label="near" />

<div style="height: 3000px" data-spacer></div>

<StampCounter {stamp} label="far" />
