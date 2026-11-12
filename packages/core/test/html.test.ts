/**
 * Contextual escaping (src/html.ts): each value of an `html` template is escaped for where it sits,
 * so text full of `"<>&'` never becomes markup, and reads back as itself.
 */
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { attr, decode_text, html, Html, trusted_html } from '../src/html.ts';

/** Strings made mostly of the characters that matter here. */
const nasty = fc.string({
	unit: fc.constantFrom('"', "'", '<', '>', '&', '=', ' ', '/', 'a', 'x', ';', '#', '\n', '$', '`'),
	maxLength: 24
});

/** The tags `markup` opens (what a browser parses as elements). */
const tags = (markup: string) => [...markup.matchAll(/<([a-zA-Z][\w-]*)/g)].map((m) => m[1]);

describe('html', () => {
	it('text between tags is escaped and reads back as itself', () => {
		fc.assert(
			fc.property(nasty, (s) => {
				const out = String(html`<p>${s}</p>`);
				expect(tags(out)).toEqual(['p']);
				expect(decode_text(out.slice(3, -4))).toBe(s);
			})
		);
	});

	it('a quoted attribute value never ends early, and reads back as itself', () => {
		fc.assert(
			fc.property(nasty, nasty, (a, b) => {
				const out = String(html`<a title="${a}" data-x='${b}'>t</a>`);
				const m = /^<a title="([^"]*)" data-x='([^']*)'>t<\/a>$/.exec(out);
				expect(m).not.toBeNull();
				expect(decode_text(m![1]!)).toBe(a);
				expect(decode_text(m![2]!)).toBe(b);
				expect(tags(out)).toEqual(['a']);
			})
		);
	});

	it('attr() makes one whole attribute, or nothing', () => {
		fc.assert(
			fc.property(nasty, (v) => {
				const out = String(html`<pre${attr('data-lang', v)}>x</pre>`);
				const m = /^<pre data-lang="([^"]*)">x<\/pre>$/.exec(out);
				expect(m).not.toBeNull();
				expect(decode_text(m![1]!)).toBe(v);
			})
		);
		expect(String(html`<pre${attr('id', null)}${attr('data-default', true)}>`)).toBe(
			'<pre data-default>'
		);
		expect(() => attr('on"x', 'v')).toThrow();
	});

	it('a URL attribute refuses a URL a browser would run', () => {
		expect(String(html`<a href="${'javascript:alert(1)'}">x</a>`)).toBe(
			'<a href="about:invalid#unsafe">x</a>'
		);
		expect(String(attr('src', ' \tDATA:text/html,x'))).toBe(' src="about:invalid#unsafe"');
		// a URL parser drops tab, LF and CR anywhere in it, the scheme included
		for (const url of [
			'java\tscript:alert(1)',
			'jav\nascript:x',
			'javascript\r:x',
			'j\ta\nv\rascript:x'
		])
			expect(String(html`<a href="${url}">x</a>`)).toBe('<a href="about:invalid#unsafe">x</a>');
		expect(String(html`<a href="${'/next?a=1&b=2'}">x</a>`)).toBe(
			'<a href="/next?a=1&amp;b=2">x</a>'
		);
	});

	it('an Html value is markup between tags, text inside an attribute', () => {
		const b = html`<b>${'1 < 2'}</b>`;
		expect(b).toBeInstanceOf(Html);
		expect(String(html`<p>${b}</p>`)).toBe('<p><b>1 &lt; 2</b></p>');
		expect(String(html`<p title="${b}"></p>`)).toBe('<p title="&lt;b>1 &amp;lt; 2&lt;/b>"></p>');
		expect(String(html`<p>${trusted_html('<i>x</i>', 'a test')}</p>`)).toBe('<p><i>x</i></p>');
	});

	it('a value outside quotes inside a tag is refused', () => {
		expect(() => html`<p class=${'x onclick=y'}></p>`).toThrow(TypeError);
	});

	it('normal values come out as the hand-written templates wrote them', () => {
		expect(String(html`<title>${'Docs: plain'}</title>`)).toBe('<title>Docs: plain</title>');
		expect(String(html`<div class="og-code" data-pref="${'pm'}">`)).toBe(
			'<div class="og-code" data-pref="pm">'
		);
		expect(`${html`${0}${null}${undefined}${false}`}`).toBe('0');
	});
});

describe('html.svelte (text written into Svelte markup, #469)', () => {
	it('escapes { and } in text and in attributes, as well as what html escapes', () => {
		expect(String(html.svelte`<p class="t">${'Use {x} & <b>'}</p>`)).toBe(
			'<p class="t">Use &#123;x&#125; &amp; &lt;b&gt;</p>'
		);
		expect(String(html.svelte`<Tab label="${'{count}"'}">`)).toBe(
			'<Tab label="&#123;count&#125;&quot;">'
		);
	});

	it('an Html value inside a tag (attr(), or one in a quoted attribute) has its braces escaped too', () => {
		expect(String(html.svelte`<Tab${attr('label', '{count}')}>`)).toBe(
			'<Tab label="&#123;count&#125;">'
		);
		expect(String(html.svelte`<Tab label="${html`<b>{x}</b>`}">`)).not.toMatch(/[{}]/);
		// between tags, markup made elsewhere is placed as is
		expect(String(html.svelte`<p>${trusted_html('<b>ok</b>', 'test')}</p>`)).toBe(
			'<p><b>ok</b></p>'
		);
	});

	it('an Html value between tags keeps its braces: its markup is placed as is', () => {
		expect(String(html.svelte`<p>${trusted_html('<b>{count}</b>', 'a test')}</p>`)).toBe(
			'<p><b>{count}</b></p>'
		);
	});

	it('no placed value ever holds a brace, and it reads back as itself', () => {
		fc.assert(
			fc.property(
				fc.string({ unit: fc.constantFrom('{', '}', '"', '<', '&', 'a'), maxLength: 16 }),
				(s) => {
					const out = String(html.svelte`<p title="${s}">${s}</p>`);
					expect(/[{}]/.test(out)).toBe(false);
					expect(decode_text(out.slice(out.indexOf('>') + 1, out.lastIndexOf('<')))).toBe(s);
				}
			)
		);
	});
});

describe('decode_text', () => {
	it('decodes what a serializer writes, numeric references, and leaves the rest', () => {
		expect(decode_text('Tom &amp; Jerry &lt;3 &#39;99 &#x263A; &quot;q&quot; &eacute; &#0;')).toBe(
			'Tom & Jerry <3 \'99 ☺ "q" &eacute; &#0;'
		);
		expect(decode_text('plain')).toBe('plain');
	});
});
