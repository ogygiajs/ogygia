import { a as flag } from '../../../../../chunks/src2.js-DnmMGXlE.js';
import { c as count_render } from '../../../../../chunks/state.js-BE3TZbql.js';

// src/routes/[lang]/[region]/flagged/+page.server.ts
var hero = flag("hero", 50);
function load({ url, request, cookies }) {
	return {
		render: count_render(url.pathname),
		variant: hero({
			request,
			url,
			cookies
		}) ? "on" : "off"
	};
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-CpJcsNOW.js.map
