import { c as count_render } from '../../../../../chunks/state.js-Bh9Tv-gh.js';

// src/routes/[lang]/[region]/quiet/+page.server.ts
/** PURE, but under a layout whose config turns postrender off: inherits it, never stored. */
function load({ url }) {
	return { render: count_render(url.pathname) };
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-CGICsr6b.js.map
