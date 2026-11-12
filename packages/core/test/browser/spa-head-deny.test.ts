// SPA-HEAD (internal/notes/INVARIANTS.md): a navigation's head merge never adopts a `<base>` (it
// would re-point every relative capability fetch) nor a `meta[http-equiv]` that refreshes the page or
// sets a CSP (a meta policy is mergeable; an HTTP header is not).
import { expect, test } from 'vitest';
import { is_dangerous_head_node } from '../../src/runtime/router-nav.ts';

const first = (head: string): Element =>
	new DOMParser().parseFromString(`<head>${head}</head>`, 'text/html').head.firstElementChild!;

test('a fetched page’s <base> and refresh / CSP metas are never adopted, in any case', () => {
	for (const html of [
		'<base href="https://example.com/">',
		'<meta http-equiv="refresh" content="0;url=https://example.com/">',
		'<meta http-equiv="REFRESH" content="5">',
		'<meta http-equiv="Content-Security-Policy" content="default-src *">',
		'<meta http-equiv="content-security-policy-report-only" content="default-src *">'
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
