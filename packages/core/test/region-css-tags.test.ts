// server/html-scan.ts `region_css_tags` — what an isolated render (a held region's body) carries
// forward from its head: BOTH region-CSS forms, in order. Keeping `<link>` only (region_css_links)
// silently unstyled every sheet small enough for Kit's `inlineStyleThreshold`, which ogygia inlines
// as `<style data-ogygia-region-css="href">`.
import { describe, expect, it } from 'vitest';
import { hole_head } from '../src/server/hole-graph.ts';
import { region_css_tags } from '../src/server/html-scan.ts';

describe('region_css_tags', () => {
	it('keeps both forms in head order; drops everything else', () => {
		const head =
			'<script type="module" data-ogygia-runtime src="/r.js"></script>' +
			'<link rel="stylesheet" href="/a.css" data-ogygia-region-css>' +
			'<link rel="modulepreload" href="/x.js">' +
			'<style data-ogygia-region-css="/b.css">.b.svelte-1{color:red}</style>' +
			'<style>.unrelated{}</style>' +
			'<meta name="ogygia-kit-island" content="/e.js">' +
			'<link rel="stylesheet" data-ogygia-region-css href="/c.css">';
		expect(region_css_tags(head)).toBe(
			'<link rel="stylesheet" href="/a.css" data-ogygia-region-css>' +
				'<style data-ogygia-region-css="/b.css">.b.svelte-1{color:red}</style>' +
				'<link rel="stylesheet" data-ogygia-region-css href="/c.css">'
		);
	});

	it('an empty or CSS-free head yields nothing; lookalike tags are not region CSS', () => {
		expect(region_css_tags('')).toBe('');
		expect(region_css_tags('<link rel="stylesheet" href="/a.css"><style>.a{}</style>')).toBe('');
		expect(region_css_tags('<linker data-ogygia-region-css><styles data-ogygia-region-css>')).toBe(
			''
		);
	});

	it('reads tags as a browser does: a quoted `>`, any case, comments, the marker as a value', () => {
		expect(
			region_css_tags(
				'<link title="a>b" href="/a.css" data-ogygia-region-css>' +
					'<LINK HREF="/b.css" DATA-OGYGIA-REGION-CSS>' +
					'<!-- <link href="/c.css" data-ogygia-region-css> -->' +
					'<link rel="stylesheet" href="/d.css?data-ogygia-region-css">' +
					'<style data-ogygia-region-css="/e.css">.e{}</STYLE>'
			)
		).toBe(
			'<link title="a>b" href="/a.css" data-ogygia-region-css>' +
				'<LINK HREF="/b.css" DATA-OGYGIA-REGION-CSS>' +
				'<style data-ogygia-region-css="/e.css">.e{}</STYLE>'
		);
	});

	it('a link written inside a style is the sheet’s text, not a tag', () => {
		expect(
			region_css_tags('<style>/* <link href="/a.css" data-ogygia-region-css> */</style>')
		).toBe('');
	});

	it('a hole answer carries no region sheet out of a comment, a meta value or the title (#976)', () => {
		const head =
			'<!-- <link rel=stylesheet href=/x.css data-ogygia-region-css> -->' +
			'<meta name="description" content="see <link data-ogygia-region-css href=/m.css>">' +
			'<title>the data-ogygia-region-css attribute</title>' +
			'<link rel="stylesheet" href="/real.css" data-ogygia-region-css>';
		expect(region_css_tags(head)).toBe(
			'<link rel="stylesheet" href="/real.css" data-ogygia-region-css>'
		);
		expect(hole_head(head, undefined)).toBe(
			'<link rel="stylesheet" href="/real.css" data-ogygia-region-css>'
		);
	});

	it('an unterminated inline sheet stops the scan instead of swallowing the rest', () => {
		expect(
			region_css_tags(
				'<link href="/a.css" data-ogygia-region-css><style data-ogygia-region-css="/b.css">.b{'
			)
		).toBe('<link href="/a.css" data-ogygia-region-css>');
	});
});
