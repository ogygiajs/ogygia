import { c as count_render } from '../../../../../chunks/state.js-Bh9Tv-gh.js';

// src/routes/[lang]/[region]/act/+page.server.ts
var tally = 0;
/** Action self-evict page: GET stores; a successful POST evicts its own URL (next GET re-renders). */
function load({ url }) {
	return {
		render: count_render(url.pathname),
		tally
	};
}
var actions = { default: () => {
	tally += 1;
	return { ok: true };
} };

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	actions: actions,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-CQ8pH1O4.js.map
