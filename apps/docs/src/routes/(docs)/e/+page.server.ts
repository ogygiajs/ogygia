import type { PageServerLoad } from './$types';
import { message_list } from '$lib/messages';

export const prerender = true;

export const load: PageServerLoad = () => ({ messages: message_list() });
