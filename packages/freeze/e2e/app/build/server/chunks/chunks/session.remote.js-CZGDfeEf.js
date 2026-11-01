import { _ as __exportAll } from './rolldown-runtime.js-CTrrmpyn.js';
import { q as query } from './remote.js-CcSc56f7.js';
import './routing.js-BCO6GjuO.js';
import './internal2.js-2Pg1NhOR.js';
import { A as getRequestEvent } from './utils.js-Ca9I6N5J.js';
import { l as init_remote_functions } from './shared.js-iXTe6R8-.js';

// src/lib/session.remote.ts
var session_remote_exports = /* @__PURE__ */ __exportAll({ whoami: () => whoami });
var whoami = /* @__PURE__ */ query(async () => {
	const { cookies } = getRequestEvent();
	return {
		user: cookies.get("user") ?? null,
		at: (/* @__PURE__ */ new Date()).toISOString()
	};
});
init_remote_functions(session_remote_exports, "src/lib/session.remote.ts", "16icjp9");
for (const [name, fn] of Object.entries(session_remote_exports)) {
	fn.__.id = "16icjp9/" + name;
	fn.__.name = name;
}

export { session_remote_exports as s, whoami as w };
//# sourceMappingURL=session.remote.js-CZGDfeEf.js.map
