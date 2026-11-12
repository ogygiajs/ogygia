// server/hole-urls.ts — a hole's HTML carries URLs Kit's `asset()` made relative to the ENDPOINT
// request (`/__ogygia__?…`); spliced into a page at `/docs/guides/` they 404. Found on a real
// site header: an interaction island inside a hole (`entry="./_app/immutable/og-region.…js"`) loaded
// from `/docs/guides/_app/…` and died on the first click.
import { describe, it, expect } from 'vitest';
import { absolutize_hole_html } from '../src/server/hole-urls.ts';

const base = new URL('http://localhost/__ogygia__?id=abc&props=e30&exp=1&sig=s');

describe('absolutize_hole_html', () => {
	it('resolves a relative island entry against the endpoint URL → root-absolute', () => {
		const html =
			'<ogygia-region entry="./_app/immutable/og-region.1d43.js" wake="interaction"></ogygia-region>';
		expect(absolutize_hole_html(html, base)).toBe(
			'<ogygia-region entry="/_app/immutable/og-region.1d43.js" wake="interaction"></ogygia-region>'
		);
	});

	it('resolves an island’s location (`src`) beside its identity — left relative, it imported `/<page>/_app/…`', () => {
		const html =
			'<ogygia-region entry="./_app/immutable/og-region.1d43.js" wake="visible" src="./_app/immutable/og-region.1d43.Xy9.js"></ogygia-region>';
		const out = absolutize_hole_html(html, new URL('http://localhost/docs/__ogygia__?id=abc'));
		expect(out).toContain('entry="/docs/_app/immutable/og-region.1d43.js"');
		expect(out).toContain('src="/docs/_app/immutable/og-region.1d43.Xy9.js"');
	});

	it('resolves a nested hole endpoint, keeping the attribute escaping of its query', () => {
		const html =
			'<ogygia-region render="defer" when="idle" endpoint="./__ogygia__?id=x&amp;props=e30&amp;exp=2&amp;sig=t"></ogygia-region>';
		expect(absolutize_hole_html(html, base)).toContain(
			'endpoint="/__ogygia__?id=x&amp;props=e30&amp;exp=2&amp;sig=t"'
		);
	});

	it('keeps Kit base when the endpoint lives under one', () => {
		const under_base = new URL('http://localhost/app/__ogygia__?id=abc');
		const html = '<ogygia-region entry="./_app/immutable/x.js"></ogygia-region>';
		expect(absolutize_hole_html(html, under_base)).toContain('entry="/app/_app/immutable/x.js"');
	});

	it('leaves absolute and foreign (federation) entries alone', () => {
		const html = `<ogygia-region entry="/_app/immutable/a.js"></ogygia-region><ogygia-region entry="https://cms.example.com/_app/immutable/b.js"></ogygia-region>`;
		expect(absolutize_hole_html(html, base)).toBe(html);
	});

	it('rewrites region-css link hrefs and nothing else in the markup', () => {
		const html = `<link rel="stylesheet" href="./_app/immutable/assets/hole.css" data-ogygia-region-css><a href="./relative-link/">keep</a><img src="./img.png">`;
		const out = absolutize_hole_html(html, base);
		expect(out).toContain('href="/_app/immutable/assets/hole.css" data-ogygia-region-css');
		expect(out).toContain('<a href="./relative-link/">keep</a><img src="./img.png">');
	});

	it('reads region tags as a browser does: any case, any quoting, a quoted `>`, not in a comment', () => {
		const html = `<!-- <ogygia-region entry="./_app/immutable/gone.js"></ogygia-region> --><OGYGIA-REGION ENTRY="./_app/immutable/a.js"></OGYGIA-REGION><ogygia-region entry='./_app/immutable/b.js'></ogygia-region><ogygia-region data-note="a>b" entry="./_app/immutable/c.js"></ogygia-region>`;
		const out = absolutize_hole_html(html, base);
		expect(out).toContain('entry="./_app/immutable/gone.js"');
		expect(out).toContain('ENTRY="/_app/immutable/a.js"');
		expect(out).toContain("entry='/_app/immutable/b.js'");
		expect(out).toContain('entry="/_app/immutable/c.js"');
	});

	it('rewrites a region-css link only when the attribute is on it, read as a browser does', () => {
		const html = `<link rel="stylesheet" href="./_app/immutable/assets/data-ogygia-region-css.css"><LINK REL="stylesheet" HREF="./_app/immutable/assets/hole.css" DATA-OGYGIA-REGION-CSS>`;
		const out = absolutize_hole_html(html, base);
		expect(out).toContain('href="./_app/immutable/assets/data-ogygia-region-css.css"');
		expect(out).toContain('HREF="/_app/immutable/assets/hole.css"');
	});

	it('is a no-op for HTML without regions or region-css links', () => {
		const html = '<p>plain <a href="./x">x</a></p>';
		expect(absolutize_hole_html(html, base)).toBe(html);
	});
});
