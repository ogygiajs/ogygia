import { p as postrender } from '../../../../chunks/src.js-BoORAn95.js';
import { b as cms_publish } from '../../../../chunks/state.js-Bh9Tv-gh.js';
import { r as read_doc } from '../../../../chunks/sources.js-CDurN4Yi.js';
import { j as json } from '../../../../chunks/utils.js-Ca9I6N5J.js';
import '../../../../chunks/source.js-A6N0KW6W.js';
import '../../../../chunks/hash.js-C-SlWFdQ.js';
import '../../../../chunks/shared.js-iXTe6R8-.js';
import '../../../../chunks/uneval.js-CHOeF-6t.js';

// src/routes/api/publish/+server.ts
/**
* The CMS "publish webhook": bump the doc, then invalidate. Body:
*   { slug }               → exact URL invalidation (the v1 primary case)
*   { prefix }             → subtree nuke (`invalidateWhere` — locale/section)
*   { doc }                → og.source PRECISION: evict every page whose receipts name the doc
*/
async function POST({ request }) {
	const body = await request.json();
	if (body.slug) {
		const { version } = cms_publish(body.slug);
		await postrender.invalidate(`/fr/fr/c/${body.slug}`);
		return json({
			ok: true,
			version
		});
	}
	if (body.prefix) {
		await postrender.invalidateWhere({ prefix: body.prefix });
		return json({ ok: true });
	}
	if (body.doc) {
		const { version } = cms_publish(body.doc);
		await postrender.invalidate(read_doc, [body.doc]);
		return json({
			ok: true,
			version
		});
	}
	return json({ ok: false }, { status: 400 });
}

export { POST };
//# sourceMappingURL=_server.ts.js-ClvX5OCj.js.map
