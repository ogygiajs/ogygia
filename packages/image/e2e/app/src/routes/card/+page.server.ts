import { ShareCard } from '$lib/cards/share.server';

export const load = () => ({
	share: ShareCard({ title: 'Ships & <harbors>', section: 'Blog' })
});
