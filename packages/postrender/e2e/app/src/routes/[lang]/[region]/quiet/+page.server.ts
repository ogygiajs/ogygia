import { count_render } from '$lib/server/state.js';

/** PURE, but under a layout whose config turns postrender off: inherits it, never stored. */
export function load({ url }) {
	return { render: count_render(url.pathname) };
}
