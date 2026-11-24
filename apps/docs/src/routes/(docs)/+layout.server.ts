import { building } from '$app/environment';
import type { LayoutServerLoad } from './$types';

const CANONICAL = 'https://ogygiajs.dev';

// @why `url.origin` is a placeholder while prerendering, so a prerendered page names the canonical origin (test: e2e/og.spec.ts › og:image points at the origin that served the page)
export const load: LayoutServerLoad = ({ url }) => ({
	ogOrigin: building ? CANONICAL : url.origin
});
