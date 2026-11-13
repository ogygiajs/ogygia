import { cms_page } from '$lib/bench/cms';

export const load = ({ url }: { url: URL }) => cms_page(url);
