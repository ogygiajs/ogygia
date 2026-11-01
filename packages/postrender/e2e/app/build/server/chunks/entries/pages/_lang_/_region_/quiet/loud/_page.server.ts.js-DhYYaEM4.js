import { c as count_render } from '../../../../../../chunks/state.js-Bh9Tv-gh.js';

// src/routes/[lang]/[region]/quiet/loud/+page.server.ts
var config = { postrender: true };
function load({ url }) {
	return { render: count_render(url.pathname) };
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	config: config,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-DhYYaEM4.js.map
