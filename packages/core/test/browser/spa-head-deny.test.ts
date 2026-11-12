// SPA-HEAD (internal/notes/INVARIANTS.md): a navigation's head merge never adopts a `<base>` (it
// would re-point every relative capability fetch) nor a `meta[http-equiv]` that refreshes the page,
// sets a CSP (a meta policy is mergeable; an HTTP header is not) or sets a cookie. The rule
// `rule_head_adopted` checks the head itself: it never gains one after the first document.
import { afterEach, expect, test } from 'vitest';
import { is_dangerous_head_node } from '../../src/runtime/head-deny.ts';
import { runtime_rules, watch_head } from '../../src/runtime/rules.ts';

const first = (head: string): Element =>
	new DOMParser().parseFromString(`<head>${head}</head>`, 'text/html').head.firstElementChild!;

test('a fetched page’s <base> and refresh / CSP / cookie metas are never adopted, in any case', () => {
	for (const html of [
		'<base href="https://example.com/">',
		'<meta http-equiv="refresh" content="0;url=https://example.com/">',
		'<meta http-equiv="REFRESH" content="5">',
		'<meta http-equiv="Content-Security-Policy" content="default-src *">',
		'<meta http-equiv="content-security-policy-report-only" content="default-src *">',
		'<meta http-equiv="Set-Cookie" content="a=b">'
	])
		expect(is_dangerous_head_node(first(html)), html).toBe(true);
});

test('an ordinary head node is adopted', () => {
	for (const html of [
		'<meta name="description" content="x">',
		'<meta charset="utf-8">',
		'<meta http-equiv="content-type" content="text/html; charset=utf-8">',
		'<link rel="stylesheet" href="/a.css">',
		'<title>t</title>'
	])
		expect(is_dangerous_head_node(first(html)), html).toBe(false);
});

const added: Element[] = [];
afterEach(() => {
	for (const el of added.splice(0)) el.remove();
});
const add = (html: string) => {
	const el = first(html);
	document.head.append(el);
	added.push(el);
};
const head_rule = () => runtime_rules.broken().filter((b) => b.code === 'rule_head_adopted');

test('rule_head_adopted: the head gains no <base> or refresh / CSP / cookie meta after the first document', () => {
	// the first document's own are its server's: kept, never counted (metas a browser ignores when
	// added later, so the test page itself is left alone: a report-only policy, a cookie)
	add('<meta http-equiv="content-security-policy-report-only" content="default-src \'self\'">');
	watch_head();
	// (the router's chunk hands in its deny as it loads)
	(globalThis as { __og_head_deny?: (d: typeof is_dangerous_head_node) => void }).__og_head_deny!(
		is_dangerous_head_node
	);
	expect(head_rule()).toEqual([]);
	add('<meta name="description" content="a page">');
	expect(head_rule()).toEqual([]);
	add('<base href="https://example.com/">');
	expect(head_rule()).toHaveLength(1);
	expect(head_rule()[0]!.detail).toMatch(/<base href="https:\/\/example\.com\/">/);
	added.pop()!.remove();
	add('<meta http-equiv="set-cookie" content="a=b">');
	expect(head_rule()).toHaveLength(1);
});
