// A large CMS page with NO regions: what the runtime costs on a page it has nothing to hydrate.
import { cms_page } from '$lib/bench/cms';

export const prerender = false;
export const load = ({ url }: { url: URL }) => cms_page(url);
