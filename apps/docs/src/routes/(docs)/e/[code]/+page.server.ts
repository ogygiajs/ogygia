import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { message_page } from '$lib/messages';

// The link a message prints: `ogygiajs.dev/e/<code>?<its arguments>`. The page words it with them.
export const load: PageServerLoad = ({ params, url }) => {
	const page = message_page(params.code, url.searchParams);
	if (!page) error(404, `No ogygia message has the code ${params.code}`);
	return page;
};
