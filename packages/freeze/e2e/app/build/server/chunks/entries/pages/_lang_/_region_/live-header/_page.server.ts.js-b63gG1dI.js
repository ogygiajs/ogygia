import { c as count_render } from '../../../../../chunks/state.js-BE3TZbql.js';

// src/routes/[lang]/[region]/live-header/+page.server.ts
/** The live-header demo shell: PURE (stores as an freeze). The header inside is
*  `render: 'live'` — baked into the stored bytes, self-freshening per visit with cookies. */
function load({ url }) {
	return { render: count_render(url.pathname) };
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-b63gG1dI.js.map
