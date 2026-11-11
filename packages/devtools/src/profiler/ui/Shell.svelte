<!--
@component
The profiler UI shell: every profiler view wraps its body in it. It renders the rail and the footer,
and it brings the shared stylesheet (./profiler.css, global on purpose) onto every profiler page.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sidebar from './Sidebar.svelte' with { wake: 'load' };
	// @why `?inline`: Kit's dev style crawl skips it, so this global sheet stays off the app's own pages (test: e2e/profiler-dev-css.spec.ts › an app page whose graph reaches the profiler shell carries none of its global sheet)
	import './profiler.css?inline';
	let {
		base = '',
		current = null,
		toc = false,
		bare = false,
		children
	}: {
		base?: string;
		current?: string | null;
		toc?: boolean;
		bare?: boolean;
		children: Snippet;
	} = $props();
</script>

<svelte:head>
	<!-- Tell the ogygia devtools to stay out of profiler pages (incl. the Profiler tab's embedded iframe). -->
	<meta name="ogygia-devtools" content="off" />
</svelte:head>

{#if bare}
	<!-- pre-auth / message pages: no rail, no polling islands, just the content centred -->
	<main class="app-main app-bare">
		{@render children()}
	</main>
{:else}
	<div class="app">
		<Sidebar {base} {current} />
		<main class="app-main" class:has-toc={toc}>
			{@render children()}
			<div class="footer">
				ogygia/profiler — samples the whole Node process during SSR. <b>Self</b> = time (or memory)
				inside the function itself. <b>Total</b> = self plus everything it called. <b>Per call</b> = total
				÷ how many times it ran (a ×N tag means it ran N times; no tag means once).
			</div>
		</main>
	</div>
{/if}

<style>
	/* The shell's own chrome (scoped). The shared vocabulary lives in ./profiler.css. */
	.footer {
		margin-top: 40px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
		color: var(--text-faint);
		font-size: 12px;
	}
</style>
