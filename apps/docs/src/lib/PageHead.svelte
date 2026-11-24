<script lang="ts">
	import { page } from '$app/state';
	import { card_path } from '$lib/og/card';

	/** Per-route document head. Title segments join as `A · ogygia`. */
	let {
		title = '',
		description = 'ogygia: Astro-style SSR islands for SvelteKit. Hydrate only what needs JavaScript.',
		category = '',
		home = false
	}: {
		title?: string;
		description?: string;
		/** Section label shown as a chip on the OG image (e.g. "Regions", "App"). */
		category?: string;
		/** Homepage variant — big italic tagline instead of a titled card. */
		home?: boolean;
	} = $props();

	const full_title = $derived(title ? `${title} · ogygia` : 'ogygia — SSR islands for SvelteKit');

	// The origin that serves this page: a preview points og:image at its own files, and prerendering
	// runs at the canonical origin (`kit.prerender.origin`), which also lets the build follow the link.
	const og_image = $derived(
		page.url.origin +
			card_path(
				home
					? { home: true }
					: { title: title || 'SSR islands for SvelteKit', ...(category ? { category } : {}) }
			)
	);
	const og_alt = $derived(
		home ? 'ogygia — SSR islands for SvelteKit' : title ? `${title} — ogygia` : 'ogygia'
	);
</script>

<svelte:head>
	<title>{full_title}</title>
	<meta name="description" content={description} />
	<meta name="theme-color" content="#0a0f0d" />
	<meta name="color-scheme" content="dark" />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="ogygia" />
	<meta property="og:title" content={full_title} />
	<meta property="og:description" content={description} />
	<meta property="og:locale" content="en_US" />
	<meta property="og:image" content={og_image} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:image:alt" content={og_alt} />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={full_title} />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={og_image} />
</svelte:head>
