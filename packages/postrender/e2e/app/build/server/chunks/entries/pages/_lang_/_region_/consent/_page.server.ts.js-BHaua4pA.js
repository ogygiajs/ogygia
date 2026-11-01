import { c as count_render } from '../../../../../chunks/state.js-Bh9Tv-gh.js';

// src/routes/[lang]/[region]/consent/+page.server.ts
/** The vary-bucket law page: reads a consent cookie WITH a default. Anonymous (no cookie) →
*  the read returns undefined = DEFAULT → this page still stores (the canonical render).
*  A visitor who set the cookie → non-default read → that request stays per-request. */
function load({ url, cookies }) {
	const n = count_render(url.pathname);
	return {
		consent: cookies.get("consent") ?? "none",
		render: n
	};
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-BHaua4pA.js.map
