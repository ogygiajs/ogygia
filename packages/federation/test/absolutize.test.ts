// ABSOLUTIZE: a peer's asset refs (island entries, stylesheets, chunks) pinned to its origin. Only
// the attribute values of real tags are refs: text that looks like one (a code sample, a comment, a
// script string) is the page's text, and the shell shows it as the peer wrote it (#974).
import { describe, expect, it } from 'vitest';
import { fuzz, html_arb, start_tags } from '@ogygia/config/html-fuzz';
import { absolutize } from '../src/wire.ts';

const O = 'https://peer.example';

/** `html` with every start tag the browser reads cut out: its text, comments and raw text. */
function outside_tags(html: string): string {
	let out = '';
	let pos = 0;
	for (const t of start_tags(html)) {
		out += html.slice(pos, t.start);
		pos = t.end;
	}
	return out + html.slice(pos);
}

describe('absolutize', () => {
	it('leaves text that looks like an asset ref as the peer wrote it', () => {
		const text =
			'<pre><code>&lt;script src="/_app/x.js"&gt;</code></pre>' +
			'<!-- <link rel="stylesheet" href="/_app/old.css"> -->' +
			'<script>const tag = \'<img src="/_app/y.js">\';</script>' +
			'<textarea>entry="/_app/z.js"</textarea>' +
			'<p>set href="/_app/a.css" on the link</p>';
		expect(absolutize(text, O)).toBe(text);
	});

	it('pins the asset refs of real tags', () => {
		expect(
			absolutize(
				'<ogygia-region entry="/_app/ogygia/og-region.a.js" endpoint="/og/frag?x=1"></ogygia-region>' +
					'<link rel="stylesheet" href="/_app/immutable/assets/a.css"><a href="/cms/p">p</a>',
				O
			)
		).toBe(
			'<ogygia-region entry="https://peer.example/_app/ogygia/og-region.a.js" endpoint="https://peer.example/og/frag?x=1"></ogygia-region>' +
				'<link rel="stylesheet" href="https://peer.example/_app/immutable/assets/a.css"><a href="/cms/p">p</a>'
		);
	});

	it('changes nothing outside the start tags the browser reads, on any page', () => {
		fuzz(
			html_arb({
				tags: ['script', 'link', 'ogygia-region', 'pre', 'textarea', 'img'],
				attrs: ['src', 'href', 'entry', 'endpoint', 'rel'],
				values: ['/_app/x.js', '/_app/a.css', 'stylesheet', '/og/frag'],
				texts: ['src="/_app/x.js"', '<script src="/_app/y.js">', 'href="/_app/a.css"']
			}),
			(html) => {
				expect(outside_tags(absolutize(html, O))).toBe(outside_tags(html));
			}
		);
	});
});
