import { count_render, cms_read } from '$lib/server/state.js';
import { read_doc } from '$lib/server/sources.js';

/** The pure content page (the app landing-page shape): CMS body keyed by slug, PLUS a shared
 *  embedded doc ('promo') read through a DECLARED source — the one-doc-on-many-pages case the
 *  og.source reverse index exists for. No personalization anywhere. A `slow-` slug reads its doc,
 *  then takes 600 ms more to render (a slow upstream): a publish can land in between (deck S21). */
export async function load({ url, params }) {
	const n = count_render(url.pathname);
	const doc = cms_read(params.slug);
	const promo = read_doc('promo');
	if (params.slug.startsWith('slow-')) await new Promise((r) => setTimeout(r, 600));
	return {
		slug: params.slug,
		version: doc.version,
		body: doc.body,
		promo: { version: promo.version },
		render: n
	};
}
