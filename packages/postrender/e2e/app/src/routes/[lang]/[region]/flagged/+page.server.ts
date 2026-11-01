import { flag } from '@ogygia/flags';
import { count_render } from '$lib/server/state.js';

// An A/B'd page: the flag READ during the render personalizes it — the postrender seam must
// disqualify this page (`flag:hero`), or one variant would be stored for every visitor.
const hero = flag('hero', 50);

export function load({ url, request, cookies }) {
	const n = count_render(url.pathname);
	const on = hero({ request, url, cookies });
	return { render: n, variant: on ? 'on' : 'off' };
}
