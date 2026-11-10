<!-- e2e/router-depth: a page three levels down; its stylesheet is linked page-relative (../../../) -->
<svelte:head>
	<title>router depth deep</title>
</svelte:head>

<h1 class="depth-deep" data-depth-deep>Deep page</h1>
<p class="depth-deep-text"><a href="/router-depth/e" data-to-shallow>to the shallow page</a></p>

<style>
	/* past the app's inline threshold (400 bytes): this sheet ships as its own <link> */
	.depth-deep {
		color: rgb(10, 20, 30);
		letter-spacing: 0.01em;
		margin-block: 1rem 0.5rem;
		padding-inline: 0.25rem;
		border-bottom: 2px solid rgb(200, 200, 210);
	}
	.depth-deep-text {
		color: rgb(40, 50, 60);
		line-height: 1.6;
		max-width: 60ch;
		margin-block: 0.5rem 2rem;
		padding: 0.5rem 0.75rem;
		background: rgb(245, 246, 248);
		border-radius: 6px;
	}
	.depth-deep-text a {
		color: rgb(20, 60, 140);
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
		font-weight: 600;
		outline-offset: 2px;
	}
	.depth-deep-text a:hover {
		color: rgb(30, 80, 180);
		text-decoration-style: dotted;
		background: rgb(235, 240, 250);
	}
</style>
