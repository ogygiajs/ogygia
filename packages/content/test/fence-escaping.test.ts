/**
 * A fence's language, permalink id and file name are author (or CMS) text: each goes into an HTML
 * attribute of the compiled page escaped, never as markup (#435).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { __set_fence_cache_dir } from '../src/markdown/fence-cache.ts';
import { normalize_shiki, render_code_region } from '../src/markdown/shiki.ts';
import { default_pipeline } from '../src/markdown/code-render.ts';
import { fc } from '@ogygia/config/sim';
import { decodeText } from '@ogygia/core/plugin/utils';
import { warm_shiki } from './_shiki-warm.ts';

warm_shiki();

beforeAll(() => __set_fence_cache_dir(null));
afterAll(() => __set_fence_cache_dir(undefined));

const cfg = normalize_shiki();
const render = (lang: string, meta = '') =>
	render_code_region(cfg, default_pipeline(), ['escaping'], 'let a = 1;', lang, meta);

/** The start tags in `html` (what a browser would parse as elements). */
const tags = (html: string) => [...html.matchAll(/<([a-z][a-z0-9-]*)/gi)].map((m) => m[1]);

describe('a fence that tries to break out of an attribute', () => {
	it('a language with a quote and markup stays inside data-lang', async () => {
		const { html } = await render('ts"><img src=x onerror=alert(1)>');
		expect(tags(html)).not.toContain('img');
		expect(html).toContain('data-lang="ts&quot;>&lt;img');
	});

	it('a permalink id with a quote and markup stays inside id', async () => {
		const { html } = await render('ts', 'ogygia-code-id=x"><img/src=x/onerror=alert(1)>');
		expect(tags(html)).not.toContain('img');
		expect(html).toContain('id="x&quot;>&lt;img');
	});

	it('any language, id and file name stay inside their attributes and read back as themselves', async () => {
		const word = fc.string({
			unit: fc.constantFrom('"', "'", '<', '>', '&', '=', '/', 'a', 'x', ';', '#', '$', '`'),
			minLength: 1,
			maxLength: 16
		});
		await fc.assert(
			fc.asyncProperty(word, word, word, async (lang, id, file) => {
				const { html } = await render(
					lang,
					`title="${file.replaceAll('"', '')}" ogygia-code-id=${id}`
				);
				const open = /<pre ((?:[\w-]+="[^"]*" )*)class=/.exec(html);
				expect(open).not.toBeNull();
				const attrs = Object.fromEntries(
					[...open![1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decodeText(m[2]!)])
				);
				expect(attrs.id).toBe(id);
				if (lang !== 'text') expect(attrs['data-lang']).toBe(lang);
				if (file.replaceAll('"', '')) expect(attrs['data-file']).toBe(file.replaceAll('"', ''));
			}),
			{ numRuns: 40 }
		);
	});

	it('a `$` pattern in the language or id is placed as written, never expanded', async () => {
		const { html } = await render("ts$'", "ogygia-code-id=x$'$&");
		expect(html).toContain(`data-lang="ts$'" id="x$'$&amp;" class=`);
	});

	it("a file name's markup characters are escaped in data-file, as in any attribute", async () => {
		const { html } = await render('ts', 'title="a<img src=x>&b"');
		expect(html).toContain('data-file="a&lt;img src=x>&amp;b"');
	});
});
