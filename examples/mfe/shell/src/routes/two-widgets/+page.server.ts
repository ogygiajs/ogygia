import type { PageServerLoad } from './$types';
import { dash } from '$lib/federation.server.js';

// Two deferred dash widgets on one page, alike but for their props.
export const load: PageServerLoad = async () => ({
	acme: await dash.widget('kpis', { org: 'acme' }, { render: 'deferred' }),
	globex: await dash.widget('kpis', { org: 'globex' }, { render: 'deferred' })
});
