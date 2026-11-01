import { B as redirect } from '../../../../chunks/utils.js-Ca9I6N5J.js';
import '../../../../chunks/shared.js-iXTe6R8-.js';
import '../../../../chunks/uneval.js-CHOeF-6t.js';

// src/routes/api/user/+server.ts
/** One-click demo login: `?name=X` sets the user cookie, no name clears it, then back to the
*  live-header page. (An /api route — never storable, content-type aside: it redirects.) */
function GET({ url, cookies }) {
	const name = url.searchParams.get("name");
	if (name) cookies.set("user", name, { path: "/" });
	else cookies.delete("user", { path: "/" });
	redirect(303, "/fr/fr/live-header");
}

export { GET };
//# sourceMappingURL=_server.ts.js-Dlz6HGVC.js.map
