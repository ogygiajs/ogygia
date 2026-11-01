import { f as freeze } from '../../../../chunks/src.js-BillxaDL.js';
import { b as cms_publish } from '../../../../chunks/state.js-BE3TZbql.js';
import { r as read_doc } from '../../../../chunks/sources.js-BMF9HSXh.js';
import { j as json } from '../../../../chunks/utils.js-Ca9I6N5J.js';
import '../../../../chunks/source.js-B4t88Kxi.js';
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
		await freeze.invalidate(`/fr/fr/c/${body.slug}`);
		return json({
			ok: true,
			version
		});
	}
	if (body.prefix) {
		await freeze.invalidateWhere({ prefix: body.prefix });
		return json({ ok: true });
	}
	if (body.doc) {
		const { version } = cms_publish(body.doc);
		await freeze.invalidate(read_doc, [body.doc]);
		return json({
			ok: true,
			version
		});
	}
	return json({ ok: false }, { status: 400 });
}

export { POST };
//# sourceMappingURL=_server.ts.js-CmqIyt5D.js.map
