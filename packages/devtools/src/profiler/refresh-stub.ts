import { tags } from '@ogygia/core/internal/server';
import { decodeText } from '@ogygia/core/plugin/utils';

const STUB_MAX_BYTES = 2048;

/**
 * The path a redirect stub sends the visitor to (`/to?q`), or null when `body` is not one. A
 * prerendered route that redirects has no server to answer 3xx, so the build writes a page with
 * `<meta http-equiv="refresh" content="0;url=/to">` that the host answers 200; the page it sends
 * the visitor to is the one to profile. The first `<meta http-equiv=refresh>` is read by core's
 * tag walk, as the browser reads it, its URL with quotes off; a body over 2 KB is a real page, not
 * a stub.
 */
export function refresh_target(body: string, origin: string): string | null {
	if (!body || body.length > STUB_MAX_BYTES) return null;
	let content: string | undefined;
	for (const t of tags(body, 'meta')) {
		if (t.attr('http-equiv')?.trim().toLowerCase() !== 'refresh') continue;
		content = t.attr('content');
		break;
	}
	if (content === undefined) return null;
	content = decodeText(content);
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
