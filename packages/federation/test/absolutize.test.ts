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
		const text = `<pre><code>&lt;script src="/_app/x.js"&gt;</code></pre><!-- <link rel="stylesheet" href="/_app/old.css"> --><script>const tag = '<img src="/_app/y.js">';\x3C/script><textarea>entry="/_app/z.js"</textarea><p>set href="/_app/a.css" on the link</p>`;
		expect(absolutize(text, O)).toBe(text);
	});

	it('pins the asset refs of real tags', () => {
		expect(
			absolutize(
				`<ogygia-region entry="/_app/ogygia/og-region.a.js" endpoint="/og/frag?x=1"></ogygia-region><link rel="stylesheet" href="/_app/immutable/assets/a.css"><a href="/cms/p">p</a>`,
				O
			)
		).toBe(
			`<ogygia-region entry="https://peer.example/_app/ogygia/og-region.a.js" endpoint="https://peer.example/og/frag?x=1"></ogygia-region><link rel="stylesheet" href="https://peer.example/_app/immutable/assets/a.css"><a href="/cms/p">p</a>`
		);
	});

	it("pins every candidate of an image's srcset and its preload's imagesrcset, built or dev", () => {
		const one = '/__ogygia__/i/5f2a/h1-320x180/_app/immutable/assets/hero.Ab12.jpg.avif';
		const two = '/__ogygia__/i/9c1e/h1-640x360/_app/immutable/assets/hero.Ab12.jpg.avif';
		const dev = '/src/lib/images/hero.jpg';
		const html = `<link rel="preload" as="image" href="${one}" imagesrcset="${one} 320w, ${two} 640w" imagesizes="100vw"><picture><source type="image/avif" srcset="${one} 320w, ${two} 640w"><img src="${dev}" srcset="${dev} 1x,${two} 2x" alt=""></picture><a href="/blog/post">a post</a>`;
		expect(absolutize(html, O)).toBe(
			`<link rel="preload" as="image" href="${O}${one}" imagesrcset="${O}${one} 320w, ${O}${two} 640w" imagesizes="100vw"><picture><source type="image/avif" srcset="${O}${one} 320w, ${O}${two} 640w"><img src="${O}${dev}" srcset="${O}${dev} 1x,${O}${two} 2x" alt=""></picture><a href="/blog/post">a post</a>`
		);
	});

	it('pins a Cloudflare link whose options hold commas as one candidate, in src and srcset alike', () => {
		const one =
			'/cdn-cgi/image/width=320,height=180,fit=cover,format=avif/_app/immutable/assets/hero.jpg';
		const two =
			'/cdn-cgi/image/width=640,height=360,fit=cover,format=avif/_app/immutable/assets/hero.jpg';
		const html = `<img src="${one}" srcset="${one} 320w,${two} 640w" alt=""><img srcset="${one}, ${two} 2x" alt="">`;
		expect(absolutize(html, O)).toBe(
			`<img src="${O}${one}" srcset="${O}${one} 320w,${O}${two} 640w" alt=""><img srcset="${O}${one}, ${O}${two} 2x" alt="">`
		);
	});

	it("pins a Vercel link (its source is in the query, encoded) to the peer, in src, srcset and a style's url()", () => {
		const one = '/_vercel/image?url=%2F_app%2Fimmutable%2Fassets%2Fhero.jpg&amp;w=640&amp;q=75';
		const two = '/_vercel/image?url=%2F_app%2Fimmutable%2Fassets%2Fhero.jpg&amp;w=1280&amp;q=75';
		const html = `<img src="${one}" srcset="${one} 640w, ${two} 1280w" alt=""><div style="background:url(&quot;${two}&quot;)"></div>`;
		expect(absolutize(html, O)).toBe(
			`<img src="${O}${one}" srcset="${O}${one} 640w, ${O}${two} 1280w" alt=""><div style="background:url(&quot;${O}${two}&quot;)"></div>`
		);
	});

	it("pins a style url() whose query's & is written &#38; or bare (markup Svelte did not write), and its numeric quotes", () => {
		const q = '/_vercel/image?url=%2F_app%2Fimmutable%2Fassets%2Fhero.jpg';
		const html = `<div style="background:url(${q}&#38;w=640)"></div><div style="background:url(${q}&w=640)"></div><div style="background:url(&#34;${q}&amp;w=640&#34;)"></div>`;
		expect(absolutize(html, O)).toBe(
			`<div style="background:url(${O}${q}&#38;w=640)"></div><div style="background:url(${O}${q}&w=640)"></div><div style="background:url(&#34;${O}${q}&amp;w=640&#34;)"></div>`
		);
	});

	it('pins an image a style attribute names (a CSS background from getImage), and leaves its other urls', () => {
		const img = '/__ogygia__/i/5f2a/h1-1280x720/_app/immutable/assets/hero.Ab12.jpg.webp';
		const html = `<section style="background-image:url(${img});color:red"></section><div style="background:url(&quot;/_app/immutable/assets/a.png&quot;) no-repeat, url('/blog/x')"></div><p style="color:blue">x</p>`;
		expect(absolutize(html, O)).toBe(
			`<section style="background-image:url(${O}${img});color:red"></section><div style="background:url(&quot;${O}/_app/immutable/assets/a.png&quot;) no-repeat, url('/blog/x')"></div><p style="color:blue">x</p>`
		);
	});

	it('pins each attribute whose names differ past ASCII, each in its own value (#1115)', () => {
		// (the browser lower-cases ASCII only: `data-Äsrc` and `data-äsrc` are two attributes)
		expect(absolutize(`<x-widget data-Äsrc="/og/a.js" data-äsrc="/og/b.js">`, O)).toBe(
			`<x-widget data-Äsrc="https://peer.example/og/a.js" data-äsrc="https://peer.example/og/b.js">`
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
