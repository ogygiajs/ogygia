import { c as count_render } from '../../../../../chunks/state.js-BE3TZbql.js';

// src/routes/[lang]/[region]/esi/+page.server.ts
/** The EDGE stitching (ESI) demo shell: PURE (stores, stays edge-cacheable). The header inside is a
*  `stitch: 'edge'` deferred hole — the capture rewrites it into an ESI include the CDN fills per
*  request; origin renders only the hole, the shell is served from the edge cache. */
function load({ url }) {
	return { render: count_render(url.pathname) };
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-DyODxxpG.js.map
