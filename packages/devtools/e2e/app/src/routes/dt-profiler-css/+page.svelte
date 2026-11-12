<script lang="ts">
	// An app page whose SSR graph reaches the profiler's Shell (the edge is planted here; in an app it
	// can come through any shared module). Kit's dev style crawl walks that graph: the profiler's
	// global sheet must still stay off this page (e2e/profiler-dev-css.spec.ts).
	import Shell from '../../../../../src/profiler/ui/Shell.svelte';
	void Shell;
</script>

<h1 data-app-page>an app page</h1>
