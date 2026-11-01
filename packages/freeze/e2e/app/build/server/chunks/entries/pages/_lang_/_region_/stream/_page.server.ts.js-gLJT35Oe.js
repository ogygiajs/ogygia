import { c as count_render } from '../../../../../chunks/state.js-BE3TZbql.js';

// src/routes/[lang]/[region]/stream/+page.server.ts
/** Never-store guard: a streamed load promise → always per-request. */
function load({ url }) {
	return {
		render: count_render(url.pathname),
		slow: new Promise((res) => setTimeout(() => res("streamed value"), 40))
	};
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-gLJT35Oe.js.map
