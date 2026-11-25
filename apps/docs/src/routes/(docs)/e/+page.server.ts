import type { PageServerLoad } from './$types';
import { message_list } from '$lib/messages';
import { ShareCard } from '$lib/og/share';

export const prerender = true;

export const load: PageServerLoad = () => {
	const messages = message_list();
	return { messages, code_cards: messages.map((m) => ShareCard({ title: m.code })) };
};
