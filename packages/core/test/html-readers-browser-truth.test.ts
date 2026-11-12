// The server's head and hole readers read a page the way the browser does (#968, #969, #970,
// #971): a tag inside a comment or inside a raw-text element's text (a script, a title) is not a
// tag, and a `>` inside a quoted value does not end one. Each case below was a real misread.
import { describe, expect, it } from 'vitest';
import {
	dedupe_head_links,
	page_declares_dev_hmr_script,
	page_declares_router_meta,
	page_declares_runtime_script,
	page_declares_speculation_rules,
	runtime_first
} from '../src/server/head-presence.ts';
import { absolutize_hole_html } from '../src/server/hole-urls.ts';

const RUNTIME = '<script type="module" data-ogygia-runtime src="/_app/r.js"></script>';

describe('runtime_first puts the runtime before the first REAL script (#968)', () => {
	it('never inside a commented-out script', () => {
		const head = `<head><!-- <script src="/old.js"></script> --><link rel="stylesheet" href="/a.css">${RUNTIME}</head>`;
		expect(runtime_first(head, null)).toBe(head);
	});

	it('never inside a title or a script whose text names a script', () => {
		const head = `<head><title>a <script> b</title><script>s = "<script>";</script>${RUNTIME}</head>`;
		expect(runtime_first(head, null)).toBe(
			`<head><title>a <script> b</title>${RUNTIME}<script>s = "<script>";</script></head>`
		);
	});
});

describe('dedupe_head_links keeps the real link (#969)', () => {
	it('when a comment holds a copy of it first', () => {
		const head =
			'<!-- <link rel="stylesheet" href="/a.css"> --><link rel="stylesheet" href="/a.css">';
		expect(dedupe_head_links(head)).toBe(head);
	});

	it('when a script’s text names it first', () => {
		const head =
			'<script>s = `<link rel="modulepreload" href="/c.js">`;</script><link rel="modulepreload" href="/c.js">';
		expect(dedupe_head_links(head)).toBe(head);
	});
});

describe('the head presence checks see real elements only (#970)', () => {
	it('not a tag in a script’s, title’s or textarea’s text, or a processing instruction', () => {
		expect(page_declares_router_meta('<script>x = `<meta name="ogygia-router">`;</script>')).toBe(
			false
		);
		expect(page_declares_runtime_script('<title><script data-ogygia-runtime></title>')).toBe(false);
		expect(page_declares_dev_hmr_script('<textarea><script data-ogygia-dev-hmr></textarea>')).toBe(
			false
		);
		expect(page_declares_speculation_rules('<?x <script type="speculationrules">?>')).toBe(false);
	});

	it('a real tag with > inside an earlier value, or spaces around =', () => {
		expect(page_declares_runtime_script('<script data-x="a>b" data-ogygia-runtime></script>')).toBe(
			true
		);
		expect(page_declares_router_meta('<meta name = "ogygia-router">')).toBe(true);
	});
});

describe('a hole answer’s URLs are made absolute past a > in a media-query schedule (#971)', () => {
	it('rewrites entry and endpoint after when="(width > 600px)"', () => {
		const out = absolutize_hole_html(
			'<ogygia-region when="(width > 600px)" entry="./_app/x.js" endpoint="./__ogygia__?x">',
			new URL('https://example.com/a/b/__ogygia__')
		);
		expect(out).toBe(
			'<ogygia-region when="(width > 600px)" entry="/a/b/_app/x.js" endpoint="/a/b/__ogygia__?x">'
		);
	});
});
