import { r as render_counts } from '../../../../chunks/state.js-BE3TZbql.js';
import { j as json } from '../../../../chunks/utils.js-Ca9I6N5J.js';
import '../../../../chunks/shared.js-iXTe6R8-.js';
import '../../../../chunks/uneval.js-CHOeF-6t.js';

// src/routes/api/state/+server.ts
/** Harness introspection: the per-route REAL render counters. (JSON — never storable.) */
function GET() {
	return json({ renders: render_counts() });
}

export { GET };
//# sourceMappingURL=_server.ts.js-DlnOE6NM.js.map
