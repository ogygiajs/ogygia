export const ShareCard = import.meta.og.image.card<{ title: string; section?: string }>(
	'./ShareCard.svelte',
	{
		width: 1200,
		height: 630,
		fonts: ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff']
	}
);
