const STUB_MAX_BYTES = 2048;

/**
 * The path a redirect stub sends the visitor to (`/to?q`), or null when `body` is not one. A
 * prerendered route that redirects has no server to answer 3xx, so the build writes a page with
 * `<meta http-equiv="refresh" content="0;url=/to">` that the host answers 200; the page it sends
 * the visitor to is the one to profile. The `content` attribute is read on either side of
 * `http-equiv`, its URL with quotes off; a body over 2 KB is a real page, not a stub.
 */
export function refresh_target(body: string, origin: string): string | null {
	if (!body || body.length > STUB_MAX_BYTES) return null;
	const lower = body.toLowerCase();
	const at = lower.indexOf('http-equiv="refresh"');
	if (at < 0) return null;
	const open = lower.lastIndexOf('<meta', at);
	const close = lower.indexOf('>', at);
	if (open < 0 || close < 0) return null;
	const tag = body.slice(open, close);
	const c = tag.toLowerCase().indexOf('content="');
	if (c < 0) return null;
	const content = tag.slice(c + 9, tag.indexOf('"', c + 9));
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
		return null; // ok: not a URL: treated like another origin's, not followed
	}
}
