import { i as initial_base, b as base, a as assets } from './internal.js-NlsCutcl.js';
import { i as resolve_route, c as add_data_suffix } from './routing.js-BCO6GjuO.js';
import './internal2.js-Cq2bWI41.js';
import { y as try_get_request_store } from './utils.js-BpLbUY9P.js';

// ../../../../node_modules/.pnpm/@sveltejs+kit@2.70.2_@opentelemetry+api@1.9.1_@sveltejs+vite-plugin-svelte@7.2.0_svelte_2ce614995eed84b42ffc972a2513643c/node_modules/@sveltejs/kit/src/runtime/app/paths/server.js
/** @type {import('./client.js').asset} */
function asset(file) {
	return assets && assets !== base ? assets + file : resolve(file);
}
/** @type {import('./client.js').resolve} */
function resolve(id, params) {
	if (!id.startsWith("/")) throw new Error(`Cannot use \`resolve(...)\` with a non-absolute pathname or route ID (got "${id}"). \`resolve\` is only for internal pathnames and route IDs; external URLs should be used directly.`);
	const resolved = resolve_route(id, params);
	{
		const store = try_get_request_store();
		if (store && !store.state.prerendering?.fallback) return ((store.event.isDataRequest ? add_data_suffix(store.event.url.pathname) : store.event.url.pathname).slice(initial_base.length).split("/").slice(2).map(() => "..").join("/") || ".") + resolved;
	}
	return base + resolved;
}

export { asset as a, resolve as r };
//# sourceMappingURL=paths.js-DHXamknv.js.map
