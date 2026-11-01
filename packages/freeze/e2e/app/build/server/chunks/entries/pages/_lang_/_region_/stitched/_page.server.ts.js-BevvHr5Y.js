import { c as count_render } from '../../../../../chunks/state.js-BE3TZbql.js';

// src/routes/[lang]/[region]/stitched/+page.server.ts
/** The serve-time stitching demo shell: PURE (stores). The header inside is a `stitch: 'serve'`
*  deferred hole — every serve renders it server-side with the visitor's cookies and splices
*  it into the stored bytes: personalized in view-source, on a page that never re-renders. */
function load({ url }) {
	return { render: count_render(url.pathname) };
}

var _page_server_ts = /*#__PURE__*/Object.freeze({
	__proto__: null,
	load: load
});

export { _page_server_ts as _ };
//# sourceMappingURL=_page.server.ts.js-BevvHr5Y.js.map
