// The large CMS page with big deferred holes: one fetched on load (about 100 KB of HTML), two below
// the fold fetched when visible (about 250 KB each), and a report-only CSP that the holes' inline
// styles and scripts violate, so the browser files a report for each while the runtime inserts them.
import { cms_page } from '$lib/bench/cms';

export const prerender = false;
export const load = ({
	url,
	setHeaders
}: {
	url: URL;
	setHeaders: (h: Record<string, string>) => void;
}) => {
	if (url.searchParams.get('csp') !== '0')
		setHeaders({
			'content-security-policy-report-only':
				"style-src 'self'; script-src 'self'; report-uri /csp-report"
		});
	return cms_page(url);
};
