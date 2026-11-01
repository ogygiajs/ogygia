import { c as count_render } from '../../../../../chunks/state.js-Bh9Tv-gh.js';

// src/routes/[lang]/[region]/setcookie/+page.server.ts
/** Never-store guard: the render WRITES a cookie → always per-request. */
function load({ url, cookies }) {
	const n = count_render(url.pathname);
	cookies.set("seen", "1", { path: "/" });
	return { render: n };
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-CMZKp7sP.js.map
