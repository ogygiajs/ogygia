<script lang="ts">
	import { page } from '$app/state';
	import { Doc } from '@ogygia/content';
	import type { PageView } from '@ogygia/content';
	import type { DocData } from '$lib/collections.server';
	import * as docs from '$lib/docs.remote';
	import PageHead from '$lib/PageHead.svelte';
	import { sameSection } from '$lib/sections';
	// The `.og-*` doc body painted in the SITE's look (the customization-ladder skin — no ogygia
	// theme.css anywhere); code-block.css styles the Shiki fences.
	import '$lib/styles/doc-skin.css';
	import '$lib/styles/code-block.css';

	// Dogfood the `.server.ts` rule: the component imports the `page` REMOTE, never the collection.
	// `page` bakes the entry's body into a region ticket (`<Doc>` renders it via `<Region>`); the
	// `.svx` demos inside wake from the baked HTML exactly as an in-pass render would. csr=false.
	const view = (await docs.page(page.params.slug ?? ''))! as PageView<DocData>;
	const data = view.entry.data;
	// The pager stays inside the page's package section (reading order never runs from one
	// package's last page into the next package), and the eyebrow names the whole path:
	// `Regions`, `@ogygia/devtools · Profiler`.
	const sectioned: PageView<DocData> = {
		...view,
		trail: {
			...view.trail,
			prev: sameSection(view.slug, view.trail.prev),
			next: sameSection(view.slug, view.trail.next)
		}
	};
	const eyebrow = view.crumbs.map((c) => c.label).join(' · ') || view.section;
</script>

<PageHead title={data.title} category={view.section} description={data.summary} />

<Doc view={sectioned} {eyebrow} crumbs={false} keepReading={view.trail?.related} />
