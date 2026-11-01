import { c as count_render } from '../../../../../chunks/state.js-Bh9Tv-gh.js';

// src/routes/[lang]/[region]/hole/+page.server.ts
/** The holes page: a pure shell (stores) with a `render:'deferred'` island inside — the hole
*  fetches fresh per request while the shell is served from the store. PPR semantics. */
function load({ url }) {
	return { render: count_render(url.pathname) };
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-1HrsfRu1.js.map
