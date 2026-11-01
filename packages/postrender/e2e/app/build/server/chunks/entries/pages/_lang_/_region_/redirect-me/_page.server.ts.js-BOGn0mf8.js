import { c as count_render } from '../../../../../chunks/state.js-Bh9Tv-gh.js';
import { B as redirect } from '../../../../../chunks/utils.js-Ca9I6N5J.js';

// src/routes/[lang]/[region]/redirect-me/+page.server.ts
/** Stored-redirect page (the bcms PDP 301 shape): permanent-canonical → the REDIRECT stores. */
function load({ url, params }) {
	count_render(url.pathname);
	redirect(301, `/${params.lang}/${params.region}/c/home`);
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-BOGn0mf8.js.map
