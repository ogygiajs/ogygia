import { count_render } from '$lib/server/state.js';

// The page's own config wins over its layout's (`postrender: false` in ../+layout.ts): stored.
export const config = { postrender: true };

export function load({ url }) {
	return { render: count_render(url.pathname) };
}
