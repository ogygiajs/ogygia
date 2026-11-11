// md() strings, code() snippets and the link collector, against the markdown pipeline they share.
import { describe, expect, it } from 'vitest';
import { render_markdown } from '../src/markdown/render-md.ts';
import { render_snippet } from '../src/markdown/snippet.ts';
import { remarkLinks } from '../src/markdown/remark-links.ts';

describe('md(): a markdown string rendered at build time', () => {
	it('renders static prose to html', async () => {
		const html = await render_markdown(null, 'Hello **there**.');
		expect(html).toContain('<strong>there</strong>');
	});

	it('content that compiles to something dynamic is a build error', async () => {
		await expect(render_markdown(null, '<script>let a = 1;</script>\n\nHi.')).rejects.toMatchObject(
			{
				code: 'content_md_dynamic'
			}
		);
	});
});

describe('code(): a snippet rendered at build time', () => {
	it('renders the same code html as the same fence in a markdown document, but for its code id', async () => {
		const snippet = await render_snippet(null, 'let a = 1;', 'js', 'file="a.js"');
		const fence = await render_markdown(null, '```js file="a.js"\nlet a = 1;\n```');
		expect(snippet.html).toContain('data-file="a.js"');
		expect(fence.replace(/ id="code-[^"]*"/, '')).toBe(snippet.html);
	});
});

describe('remarkLinks', () => {
	type Node = { type: string; url?: string; value?: string; children?: Node[] };
	const collect = (tree: Node) => {
		const file = { data: {} as Record<string, unknown> };
		remarkLinks()(tree as never, file);
		return (file.data.fm as { links: { href: string }[] }).links.map((l) => l.href);
	};
	const link = (url: string): Node => ({
		type: 'link',
		url,
		children: [{ type: 'text', value: url }]
	});

	it('collects every markdown link, whatever it points at; raw <a> html is not a link node', () => {
		const tree: Node = {
			type: 'root',
			children: [
				{
					type: 'paragraph',
					children: [
						link('https://example.com'),
						link('/docs/a'),
						link('#here'),
						link('mailto:a@example.com'),
						{ type: 'html', value: '<a href="/docs/raw">raw</a>' }
					]
				}
			]
		};
		expect(collect(tree)).toEqual([
			'https://example.com',
			'/docs/a',
			'#here',
			'mailto:a@example.com'
		]);
	});
});
