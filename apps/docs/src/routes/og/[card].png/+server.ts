// Share images, made at build time: one PNG file per card (`/og/<key>.png`, $lib/og/card.ts). The
// card is a self-contained Svelte component rendered to HTML (`svelte/server` `render`), converted
// to a satori node tree, rasterised to PNG by resvg. Prerendering follows each page's og:image to
// here; `entries()` adds the cards of the pages rendered on each request, which it never visits.
import { error } from '@sveltejs/kit';
import { read } from '$app/server';
import { render } from 'svelte/server';
import satori from 'satori';
import { html as toSatori } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import OgCard from '$lib/og/OgCard.svelte';

// The site's display face, subset by scripts/subset-fonts.ts (woff: satori reads no woff2). ONE
// weight (400), upright only, so the card's serif rules use exactly that.
import Serif from '$lib/fonts/geist-serif-latin.woff';
import Mono from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff';

import { card_key, card_of, SERVER_PAGE_TITLES, type Card } from '$lib/og/card';
import { message_list } from '$lib/messages';
import { packages } from '$lib/releases/releases.server';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;

export const entries: EntryGenerator = async () => {
	const cards: Card[] = [
		{ home: true },
		...Object.values(SERVER_PAGE_TITLES).map((title) => ({ title })),
		...message_list().map((m) => ({ title: m.code })),
		...(await packages.refs()).map((p) => ({ title: p.data.name }))
	];
	return cards.map((card) => ({ card: card_key(card) }));
};

let fonts_promise: Promise<
	{ name: string; data: ArrayBuffer; weight: 400 | 500; style: 'normal' }[]
> | null = null;

function load_fonts() {
	fonts_promise ??= Promise.all([read(Serif).arrayBuffer(), read(Mono).arrayBuffer()]).then(
		([serif, mono]) => [
			{ name: 'Geist Serif', data: serif, weight: 400 as const, style: 'normal' as const },
			{ name: 'JetBrains Mono', data: mono, weight: 500 as const, style: 'normal' as const }
		]
	);
	return fonts_promise;
}

export const GET: RequestHandler = async ({ params }) => {
	const card = card_of(params.card);
	if (!card) error(404, 'No share image has this name');
	const home = card.home === true;
	const title = card.home ? '' : card.title;
	const category = card.home ? '' : (card.category ?? '');

	// Svelte escapes text (`&` → `&amp;`), and satori-html doesn't decode entities — so a title like
	// "SPA router & PPR" would render the literal `&amp;`. Decode the safe text entities here. `&lt;`/
	// `&gt;` are left escaped so a stray `<` in a title can't reopen the markup satori-html re-parses.
	// `css="injected"` puts scoped CSS in `head` as a <style> block; markup is in `body`. satori
	// resolves the scoped class selectors when handed both together. The CSS is collapsed onto one
	// line first: satori's gradient parser throws on a value the formatter wrapped across lines.
	const rendered = render(OgCard, { props: { title, category, home } });
	const decoded = (rendered.head.replace(/\s+/g, ' ') + rendered.body)
		.replace(/&#0?39;/g, "'")
		.replace(/&#x27;/gi, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&');
	const markup = toSatori(decoded);

	const svg = await satori(markup, { width: 1200, height: 630, fonts: await load_fonts() });
	const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();

	return new Response(new Uint8Array(png), {
		headers: {
			'content-type': 'image/png',
			// crawlers hit this once and cache; the CDN holds it, the browser re-checks hourly
			'cache-control': 'public, max-age=3600, s-maxage=604800'
		}
	});
};
