<!-- e2e/router-depth: a page one level down; its stylesheet is linked page-relative (../) -->
<svelte:head>
	<title>router depth shallow</title>
</svelte:head>

<h1 class="depth-shallow" data-depth-shallow>Shallow page</h1>
<p class="depth-shallow-text"><a href="/router-depth/a/b/c" data-to-deep>to the deep page</a></p>

<style>
	/* past the app's inline threshold (400 bytes): this sheet ships as its own <link> */
	.depth-shallow {
		color: rgb(120, 30, 40);
		letter-spacing: 0.02em;
		margin-block: 1.5rem 0.75rem;
		padding-inline: 0.5rem;
		border-bottom: 3px solid rgb(220, 180, 180);
	}
	.depth-shallow-text {
		color: rgb(60, 40, 50);
		line-height: 1.7;
		max-width: 58ch;
		margin-block: 0.75rem 2.5rem;
		padding: 0.75rem 1rem;
		background: rgb(250, 244, 244);
		border-radius: 8px;
	}
	.depth-shallow-text a {
		color: rgb(140, 40, 60);
		text-decoration-thickness: 1px;
		text-underline-offset: 4px;
		font-weight: 500;
		outline-offset: 3px;
	}
	.depth-shallow-text a:hover {
		color: rgb(170, 50, 70);
		text-decoration-style: wavy;
		background: rgb(252, 238, 240);
	}
</style>
