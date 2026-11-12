// A prerendered route that redirects is written as a page: a meta refresh (and a script) answered
// 200. The profiler follows it as the redirect it is, to the page its visitors land on.
import { expect, test } from 'vitest';
import { refresh_target } from '../src/profiler/refresh-stub.ts';

const origin = 'http://127.0.0.1:4192';

test('the build’s redirect stub: the path it sends the visitor to', () => {
	const kit =
		'<script>location.href="/docs/start/overview";</script><meta http-equiv="refresh" content="0;url=/docs/start/overview">';
	expect(refresh_target(kit, origin)).toBe('/docs/start/overview');
	// other spellings: the attribute order, a space, quotes, a query, the full URL of this origin
	expect(refresh_target(`<meta content="0; URL='/a?b=1'" http-equiv="refresh">`, origin)).toBe(
		'/a?b=1'
	);
	expect(refresh_target(`<META HTTP-EQUIV="refresh" CONTENT="0;url=${origin}/x">`, origin)).toBe(
		'/x'
	);
	expect(refresh_target('<meta http-equiv="refresh" content="0;url=docs">', `${origin}/`)).toBe(
		'/docs'
	);
});

// the tag is read the way the browser reads it, not in one quoting (#1370)
test('a stub in any spelling the browser reads: quotes, no quotes, spaces, a > in a value', () => {
	for (const tag of [
		`<meta http-equiv='refresh' content='0;url=/x'>`,
		'<meta http-equiv=refresh content=0;url=/x>',
		'<meta http-equiv = "refresh" content = "0;url=/x">',
		'<meta data-note="a>b" http-equiv="refresh" content="0;url=/x">',
		'<meta http-equiv="Refresh" content="0;url=/x" content="0;url=/y">'
	])
		expect(refresh_target(tag, origin), tag).toBe('/x');
	// text that only names a refresh is not one
	expect(
		refresh_target('<p>write http-equiv="refresh" content="0;url=/x" in a meta</p>', origin)
	).toBeNull();
	expect(
		refresh_target('<meta name="x" content=\'http-equiv="refresh"\' data-c="0;url=/x">', origin)
	).toBeNull();
});

test('not a stub: no refresh, another origin, no url, a real page', () => {
	expect(refresh_target('<p>hi</p>', origin)).toBeNull();
	expect(
		refresh_target('<meta http-equiv="refresh" content="0;url=https://elsewhere.test/">', origin)
	).toBeNull();
	// a refresh that only reloads the page
	expect(refresh_target('<meta http-equiv="refresh" content="30">', origin)).toBeNull();
	// a whole page with a refresh tag is a page
	expect(
		refresh_target(
			`<meta http-equiv="refresh" content="0;url=/x">${'<p>text</p>'.repeat(300)}`,
			origin
		)
	).toBeNull();
	expect(refresh_target('', origin)).toBeNull();
});
