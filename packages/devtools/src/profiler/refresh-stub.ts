import { tags } from '@ogygia/core/internal/server';

const STUB_MAX_BYTES = 2048;

/**
 * The path a redirect stub sends the visitor to (`/to?q`), or null when `body` is not one. A
 * prerendered route that redirects has no server to answer 3xx, so the build writes a page with
 * `<meta http-equiv="refresh" content="0;url=/to">` that the host answers 200; the page it sends
 * the visitor to is the one to profile. The first refresh `<meta>` core's tag walk finds (any
 * quoting, a comment or a script's text holds none), its URL with quotes off; a body over 2 KB is
 * a real page, not a stub.
 */
export function refresh_target(body: string, origin: string): string | null {
	if (!body || body.length > STUB_MAX_BYTES) return null;
	let content: string | undefined;
	for (const meta of tags(body, 'meta'))
		if (meta.attr('http-equiv')?.toLowerCase() === 'refresh') {
			content = meta.attr('content');
			break;
		}
	if (content === undefined) return null;
	const u = content.toLowerCase().indexOf('url=');
	if (u < 0) return null;
	let to = content.slice(u + 4).trim();
	const q = to[0];
	if (q === "'" || q === '"') to = to.endsWith(q) && to.length > 1 ? to.slice(1, -1) : to.slice(1);
	if (!to) return null;
	try {
		const url = new URL(to, origin);
		if (url.origin !== new URL(origin).origin) return null;
		return url.pathname + url.search;
	} catch {
		return null;
	}
}
