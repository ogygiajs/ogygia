import type { PageServerLoad } from './$types';
import { dash } from '$lib/federation.server.js';

// A static widget the dash app does not serve (it answers 404): the widget's place shows its
// boundary card and the page still renders. Any answer the shell can't use does the same (an
// error status, a body that is not the widget's document), and the shell logs
// `federation_peer_answer_invalid`.
export const load: PageServerLoad = async () => {
	return {
		retired: await dash.widget('retired', { org: 'acme' }),
		kpis: await dash.widget('kpis', { org: 'acme' })
	};
};
