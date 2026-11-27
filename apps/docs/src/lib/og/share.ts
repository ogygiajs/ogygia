/** The site's share card: one PNG per page, drawn from OgCard.svelte with its props. */
export const ShareCard = import.meta.og.image.card<{
	title?: string;
	category?: string;
	home?: boolean;
}>('./OgCard.svelte', {
	width: 1200,
	height: 630,
	fonts: [
		'../fonts/geist-serif-latin.woff',
		'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
	]
});
