/**
 * SPA-HEAD (internal/notes/INVARIANTS.md): the head nodes a navigation never adopts from fetched
 * HTML. A `<base>` re-points every relative capability fetch; a `meta[http-equiv]` that refreshes,
 * sets a CSP (a meta policy is mergeable, an HTTP header is not) or sets a cookie acts on the page
 * the moment it lands. The router's head merge skips them (./router-nav.ts), and the rule
 * `rule_head_adopted` (./rules.ts) checks the head never gains one after the first document.
 *
 * @packageDocumentation
 */

const DENIED_HTTP_EQUIV: ReadonlySet<string> = new Set([
	'refresh',
	'content-security-policy',
	'content-security-policy-report-only',
	'set-cookie'
]);

/** A head node never adopted from fetched HTML (test/browser/spa-head-deny.test.ts). */
export function is_dangerous_head_node(node: Element): boolean {
	const tag = node.tagName;
	if (tag === 'BASE') return true;
	if (tag !== 'META') return false;
	return DENIED_HTTP_EQUIV.has((node.getAttribute('http-equiv') || '').toLowerCase());
}
