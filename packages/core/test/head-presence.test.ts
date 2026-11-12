import { describe, it, expect } from 'vitest';
import {
	page_declares_router_meta,
	page_declares_runtime_script,
	page_declares_dev_hmr_script,
	page_declares_speculation_rules,
	runtime_first
} from '../src/server/head-presence.ts';

// ─────────────────────────────────────────────────────────────────────────────
// The `handle()` transform skips injecting a head tag the page already carries. These predicates
// decide "already carries", and MUST NOT be fooled by a page that documents the tag in prose.
//
// Regression: the changelog page has `` `<meta name="ogygia-router" content="plain">` `` in its body,
// which renders escaped (`&lt;meta name="ogygia-router" …`). A substring check false-matched it, so
// the real marker was never injected and the page silently dropped to full-page navigation (no SPA,
// no view transition), TO and FROM it.
// ─────────────────────────────────────────────────────────────────────────────

// How markdown renders an inline `` `<meta …>` `` code span: `<` escaped to `&lt;`, `>` left literal.
const escaped_meta =
	'<p>opt out with <code>&lt;meta name="ogygia-router" content="plain"></code> in its head.</p>';
const escaped_runtime = '<p>island pages carry <code>data-ogygia-runtime</code>.</p>';

describe('page_declares_router_meta', () => {
	it('is FALSE for an escaped code-block mention (the changelog case)', () => {
		expect(page_declares_router_meta(escaped_meta)).toBe(false);
	});

	it('is FALSE when a fenced block splits the tag across highlighter spans', () => {
		// Shiki-style: the `<` is still escaped, so no literal `<meta` survives.
		const shiki = '<pre><code><span>&lt;</span><span>meta name="ogygia-router"</span></code></pre>';
		expect(page_declares_router_meta(shiki)).toBe(false);
	});

	it('is TRUE for a real author-authored element (page wins — feature preserved)', () => {
		expect(
			page_declares_router_meta('<head><meta name="ogygia-router" content="plain"></head>')
		).toBe(true);
	});

	it('is TRUE regardless of attribute order or quote style', () => {
		expect(page_declares_router_meta('<meta content="plain" name="ogygia-router">')).toBe(true);
		expect(page_declares_router_meta("<meta name='ogygia-router' content='vt'>")).toBe(true);
		expect(page_declares_router_meta('<meta\n  name="ogygia-router"\n  content="vt">')).toBe(true);
	});

	it('is FALSE with no mention at all', () => {
		expect(page_declares_router_meta('<head><title>x</title></head>')).toBe(false);
	});
});

describe('page_declares_runtime_script', () => {
	it('is FALSE for an escaped/code mention', () => {
		expect(page_declares_runtime_script(escaped_runtime)).toBe(false);
	});

	it('is FALSE when only the SCRIPT BODY (inline JS) references the attribute', () => {
		expect(
			page_declares_runtime_script(
				'<script>document.querySelector("[data-ogygia-runtime]")</script>'
			)
		).toBe(false);
	});

	it('is TRUE for the real bootstrap tag Region emits', () => {
		expect(
			page_declares_runtime_script(
				'<script type="module" data-ogygia-runtime src="/x.js"></script>'
			)
		).toBe(true);
	});
});

describe('page_declares_dev_hmr_script', () => {
	it('distinguishes a real tag from a code mention', () => {
		expect(page_declares_dev_hmr_script('<code>data-ogygia-dev-hmr</code>')).toBe(false);
		expect(
			page_declares_dev_hmr_script(
				'<script type="module" data-ogygia-dev-hmr src="/h.js"></script>'
			)
		).toBe(true);
	});
});

describe('page_declares_speculation_rules', () => {
	it('distinguishes a real tag from a code mention', () => {
		expect(page_declares_speculation_rules('<code>type="speculationrules"</code>')).toBe(false);
		expect(page_declares_speculation_rules('<script type="speculationrules">{}</script>')).toBe(
			true
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// The runtime bootstrap is the FIRST script in `<head>`. Module scripts run in document order
// once parsing ends; a design-system runtime an app template loads ahead of Kit's head slot ran
// before the ogygia runtime on a customer page and edited every sleeping island before the runtime
// kept their server markup — so the "server copy" was the edited DOM and no island could heal.
// ─────────────────────────────────────────────────────────────────────────────
const runtime = '<script type="module" data-ogygia-runtime src="/_app/og-runtime.js"></script>';
const design_system = '<script type="module" src="https://cdn.example/ds.js"></script>';
const head_start =
	'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="w">';

describe('runtime_first — before all of the page’s JavaScript, not first in the head', () => {
	it('moves the tag an island page emitted to just before the app template’s first script', () => {
		const head =
			head_start +
			design_system +
			'<title>x</title>' +
			runtime +
			'<link rel="stylesheet" href="/a.css">';
		expect(runtime_first(head, null)).toBe(
			head_start +
				runtime +
				design_system +
				'<title>x</title>' +
				'<link rel="stylesheet" href="/a.css">'
		);
	});

	it('injects the tag there when the page has none (island-less page, router on)', () => {
		expect(runtime_first(head_start + design_system, runtime)).toBe(
			head_start + runtime + design_system
		);
	});

	it('keeps stylesheets and the LCP image preload AHEAD of it — only JavaScript comes after', () => {
		const css = '<link rel="stylesheet" href="/a.css">';
		const lcp = '<link rel="preload" as="image" href="/hero.avif" fetchpriority="high">';
		const font = '<link rel="preload" as="font" href="/f.woff2" crossorigin>';
		expect(runtime_first(head_start + css + lcp + font + design_system + runtime, null)).toBe(
			head_start + css + lcp + font + runtime + design_system
		);
	});

	it('a modulepreload counts as JavaScript: the runtime goes before it too', () => {
		const css = '<link rel="stylesheet" href="/a.css">';
		const preload = '<link rel="modulepreload" href="/_app/start.js">';
		expect(runtime_first(head_start + css + preload + design_system + runtime, null)).toBe(
			head_start + css + runtime + preload + design_system
		);
	});

	it('moves the runtime’s own modulepreload hints WITH it, as one unit', () => {
		const deps =
			'<link rel="modulepreload" href="/c/a.js" data-ogygia-runtime-dep>' +
			'<link rel="modulepreload" href="/c/b.js" data-ogygia-runtime-dep>';
		const css = '<link rel="stylesheet" href="/a.css">';
		expect(
			runtime_first(head_start + css + design_system + '<title>x</title>' + runtime + deps, null)
		).toBe(head_start + css + runtime + deps + design_system + '<title>x</title>');
		// already in place with its hints: untouched
		const placed = head_start + css + runtime + deps + design_system;
		expect(runtime_first(placed, null)).toBe(placed);
	});

	it('with no JavaScript in the head, it goes last in the head', () => {
		const head = '<html><head><meta charset="utf-8"><title>t</title></head><body>';
		expect(runtime_first(head, runtime)).toBe(
			'<html><head><meta charset="utf-8"><title>t</title>' + runtime + '</head><body>'
		);
		// a head slice with no closing tag: at the end of the slice
		expect(runtime_first('<title>t</title>', runtime)).toBe('<title>t</title>' + runtime);
	});

	it('leads the scripts when no charset declaration opens the head', () => {
		expect(runtime_first('<html><head>' + design_system + runtime, null)).toBe(
			'<html><head>' + runtime + design_system
		);
	});

	it('inner head content with no <head> tag (a routeless document): before its first script', () => {
		expect(runtime_first('<title>t</title>' + design_system + runtime, null)).toBe(
			'<title>t</title>' + runtime + design_system
		);
	});

	it('returns the same string when the tag is already first, or there is nothing to place', () => {
		const already = '<html><head><meta charset="utf-8">' + runtime + design_system;
		expect(runtime_first(already, null)).toBe(already);
		expect(runtime_first(already, runtime)).toBe(already);
		const none = '<html><head>' + design_system;
		expect(runtime_first(none, null)).toBe(none);
	});

	it('does not mistake a prose mention or an inline script body for the tag', () => {
		const prose =
			'<html><head>' +
			design_system +
			escaped_runtime +
			'<script>document.querySelector("[data-ogygia-runtime]")</script>';
		expect(runtime_first(prose, null)).toBe(prose);
		expect(runtime_first(prose, runtime)).toBe(
			'<html><head>' +
				runtime +
				design_system +
				escaped_runtime +
				'<script>document.querySelector("[data-ogygia-runtime]")</script>'
		);
	});
});

describe('runtime_first — the response’s mark on the tag it places (RESPONSE-MARK)', () => {
	const marked =
		'<script data-og-mark="m1" type="module" data-ogygia-runtime src="/_app/og-runtime.js"></script>';

	it('writes the mark on a moved tag, an injected tag and a tag already in place', () => {
		expect(runtime_first(head_start + design_system + runtime, null, [], 'm1')).toBe(
			head_start + marked + design_system
		);
		expect(runtime_first(head_start + design_system, runtime, [], 'm1')).toBe(
			head_start + marked + design_system
		);
		expect(runtime_first(head_start + runtime + design_system, null, [], 'm1')).toBe(
			head_start + marked + design_system
		);
	});

	it('leads the attributes, so a mark the markup put on the tag loses', () => {
		const forged =
			'<script type="module" data-og-mark="m2" data-ogygia-runtime src="/x.js"></script>';
		const out = runtime_first(head_start + forged, null, [], 'm1');
		const el = out.slice(head_start.length);
		expect(el.indexOf('data-og-mark="m1"')).toBeLessThan(el.indexOf('data-og-mark="m2"'));
	});

	it('writes the mark and the code origins on the same tag, the mark first', () => {
		const out = runtime_first(head_start + runtime, null, ['https://peer.example/x.js'], 'm1');
		expect(out).toBe(
			head_start +
				'<script data-og-mark="m1" type="module" data-ogygia-runtime data-og-origins="https://peer.example" src="/_app/og-runtime.js"></script>'
		);
	});

	it('leaves the head alone with no mark (no request: nothing to mark)', () => {
		const head = head_start + runtime + design_system;
		expect(runtime_first(head, null)).toBe(head);
	});
});
