const DENIED_HTTP_EQUIV: ReadonlySet<string> = new Set([
	'refresh',
	'content-security-policy',
	'content-security-policy-report-only',
	'set-cookie'
]);

// @why a `<base>` re-points every relative URL, and a refresh, CSP or cookie `meta[http-equiv]` acts on the page the moment it is inserted (test: test/browser/spa-head-deny.test.ts › a fetched page’s <base> and refresh / CSP / cookie metas are never adopted, in any case)
/** A head node never adopted from fetched HTML. */
export function is_dangerous_head_node(node: Element): boolean {
	const tag = node.tagName;
	if (tag === 'BASE') return true;
	if (tag !== 'META') return false;
	return DENIED_HTTP_EQUIV.has((node.getAttribute('http-equiv') || '').toLowerCase());
}
