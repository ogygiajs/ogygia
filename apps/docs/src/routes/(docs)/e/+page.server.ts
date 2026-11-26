import type { PageServerLoad } from './$types';
import { message_list } from '$lib/messages';
import { ShareCard } from '$lib/og/share';

export const prerender = true;

export const load: PageServerLoad = () => {
	const messages = message_list();
	for (const m of messages) ShareCard({ title: m.code });
	return { messages };
};
