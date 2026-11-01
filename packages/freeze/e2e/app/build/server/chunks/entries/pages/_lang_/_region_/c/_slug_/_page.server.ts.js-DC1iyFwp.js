import { c as count_render, a as cms_read } from '../../../../../../chunks/state.js-BE3TZbql.js';
import { r as read_doc } from '../../../../../../chunks/sources.js-BMF9HSXh.js';

// src/routes/[lang]/[region]/c/[slug]/+page.server.ts
/** The pure content page (the bcms landing-page shape): CMS body keyed by slug, PLUS a shared
*  embedded doc ('promo') read through a DECLARED source — the one-doc-on-many-pages case the
*  og.source reverse index exists for. No personalization anywhere. */
function load({ url, params }) {
	const n = count_render(url.pathname);
	const doc = cms_read(params.slug);
	const promo = read_doc("promo");
	return {
		slug: params.slug,
		version: doc.version,
		body: doc.body,
		promo: { version: promo.version },
		render: n
	};
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-DC1iyFwp.js.map
