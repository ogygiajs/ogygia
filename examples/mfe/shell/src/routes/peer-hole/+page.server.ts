import type { PageServerLoad } from './$types';
import { dash } from '$lib/federation.server.js';

// A dash widget with a server island inside it, twice: baked into this page, and deferred (a hole
// the browser fetches through the shell).
export const load: PageServerLoad = async () => ({
	baked: await dash.widget('holder', { who: 'baked' }),
	deferred: await dash.widget('holder', { who: 'deferred' }, { render: 'deferred' })
});
