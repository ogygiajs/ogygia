import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { dedent } from '@ogygia/core/plugin/utils';
import { EXTENSION_API, markdown_extension } from '../src/vite/markdown.ts';
import { image } from '../src/vite/index.ts';
import { url_of_remote_src } from '../src/vite/remote.ts';

type Hast = {
	type?: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: Hast[];
};

let dir: string;
let post: string;
beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-md-'));
	for (const name of ['harbor.jpg', 'my photo.jpg', 'café.jpg', 'cover.jpg'])
		fs.writeFileSync(path.join(dir, name), '');
	post = path.join(dir, '+post.md');
});

type Extension = NonNullable<ReturnType<typeof markdown_extension>>;
type Bridge = Omit<Extension, 'rehype'> & { rehype: Extension['rehype'][0]['plugin'] };

/** The extension `image()` offers content, its one rehype entry unwrapped. */
function bridge(width?: number, prose?: boolean, animated?: string): Bridge {
	const ext = markdown_extension({
		...(width === undefined && animated === undefined
			? {}
			: {
					markdown: { ...(width === undefined ? {} : { width }), ...(animated ? { animated } : {}) }
				}),
		presets: {
			...(prose ? { prose: { width: 720 } } : {}),
			...(animated ? { [animated]: { width: 240, sizes: '33vw' } } : {})
		}
	})!;
	return { ...ext, rehype: ext.rehype[0].plugin };
}

/** A paragraph holding one markdown image, as mdast-util-to-hast hands it to rehype. */
function tree_of(properties: Record<string, unknown>): Hast {
	return {
		type: 'root',
		children: [
			{ type: 'element', tagName: 'p', children: [{ type: 'element', tagName: 'img', properties }] }
		]
	};
}

/** Run the rehype step, then `finish` on what it wrote: the body and the module-script lines. */
function compile(tree: Hast, b = bridge()): { body: string; lines: string[] } {
	b.rehype()(tree, { filename: post });
	const raws: string[] = [];
	const collect = (n: Hast): void => {
		if (n.type === 'raw') raws.push(n.value!);
		n.children?.forEach(collect);
	};
	collect(tree);
	const done = b.finish(raws.join('\n'), post);
	return { body: done.code, lines: done.lines };
}

/** mdsvex's module script for a document with this frontmatter, through `finish`. */
function frontmatter(data: Record<string, unknown>): { code: string; lines: string[] } {
	const code = dedent`
		<script context="module">
			export const metadata = ${JSON.stringify(data)};
		</script>
		<p>x</p>
	`;
	const done = bridge().finish(code, post);
	return { code: done.code, lines: done.lines };
}

describe('frontmatter images', () => {
	test('a ./ path to an image becomes a descriptor import, in place in the metadata', () => {
		const { code, lines } = frontmatter({ title: 'T', cover: './cover.jpg' });
		expect(lines).toEqual(['import __og_fm_image_0 from "./cover.jpg?og-image";']);
		expect(code).toContain('export const metadata = {"title":"T","cover":__og_fm_image_0};');
	});

	test('nested and listed paths become descriptors too', () => {
		const { code } = frontmatter({ gallery: ['./harbor.jpg', { src: './cover.jpg' }] });
		expect(code).toContain('{"gallery":[__og_fm_image_0,{"src":__og_fm_image_1}]}');
	});

	test('a value with no ./ or ../ prefix stays a string, even when it ends in an image extension', () => {
		const data = { share: 'images/share.png', diagram: 'diagram.png', site: '/og.png' };
		const { code, lines } = frontmatter(data);
		expect(lines).toEqual([]);
		expect(code).toContain(JSON.stringify(data));
	});

	test('a ./ or ../ path to a missing image fails the build, naming it', () => {
		expect(() => frontmatter({ cover: '../gone.jpg' })).toThrow(/'\.\.\/gone\.jpg' does not exist/);
	});

	test('a frontmatter path is a file path: a % in it is not an escape', () => {
		fs.writeFileSync(path.join(dir, '100%.jpg'), '');
		const { lines } = frontmatter({ cover: './100%.jpg' });
		expect(lines).toEqual(['import __og_fm_image_0 from "./100%.jpg?og-image";']);
	});
});

test('finish names every image file a post shows, body and frontmatter, so a kept compile of the post is checked again once one is gone', () => {
	const b = bridge();
	const tree = tree_of({ src: './my%20photo.jpg', alt: '' });
	b.rehype()(tree, { filename: post });
	const raws: string[] = [];
	const collect = (n: Hast): void => {
		if (n.type === 'raw') raws.push(n.value!);
		n.children?.forEach(collect);
	};
	collect(tree);
	const script = `<script context="module">export const metadata = ${JSON.stringify({ cover: './cover.jpg' })};</script>`;
	const done = b.finish(`${script}\n${raws.join('\n')}`, post);
	expect([...(done.files ?? [])].sort()).toEqual(
		[path.join(dir, 'cover.jpg'), path.join(dir, 'my photo.jpg')].sort()
	);
});

describe('markdown body images', () => {
	test('a local image renders through <Og__Img>, imported under the og-image query', () => {
		const { body, lines } = compile(tree_of({ src: './harbor.jpg', alt: 'A harbor' }));
		expect(body).toContain('<Og__Img of={__og_md_image_0} alt="A harbor" />');
		expect(lines).toContain(`import Og__Img from '@ogygia/image/Img.svelte';`);
		expect(lines).toContain('import __og_md_image_0 from "./harbor.jpg?og-image";');
	});

	test('markdown.width rides as the image width; the source import carries no width', () => {
		const { body, lines } = compile(tree_of({ src: 'harbor.jpg', alt: '' }), bridge(720));
		expect(body).toContain('width={720}');
		expect(lines.at(-1)).toBe('import __og_md_image_0 from "./harbor.jpg?og-image";');
	});

	test('a prose preset, when the config has one, is how a body image is shown', () => {
		const { body } = compile(tree_of({ src: './harbor.jpg', alt: '' }), bridge(720, true));
		expect(body).toContain('preset="prose"');
		expect(body).not.toContain('width=');
	});

	test('with markdown.animated, a moving source takes that preset and a still one the prose preset', () => {
		const { body } = compile(
			tree_of({ src: './harbor.jpg', alt: '' }),
			bridge(undefined, true, 'motion')
		);
		expect(body).toContain('preset={__og_md_image_0.animated ? "motion" : "prose"}');
		expect(body).not.toContain('width=');
	});

	test('with markdown.animated and markdown.width, the width is a still image’s only, so the preset’s width reaches a moving one', () => {
		const { body } = compile(
			tree_of({ src: './harbor.jpg', alt: '' }),
			bridge(720, false, 'motion')
		);
		expect(body).toContain('preset={__og_md_image_0.animated ? "motion" : undefined}');
		expect(body).toContain('width={__og_md_image_0.animated ? undefined : 720}');
	});

	test('with markdown.animated alone, a still image is as wide as itself', () => {
		const { body } = compile(
			tree_of({ src: './harbor.jpg', alt: '' }),
			bridge(undefined, false, 'motion')
		);
		expect(body).toContain('preset={__og_md_image_0.animated ? "motion" : undefined}');
		expect(body).not.toContain('width=');
	});

	test('alt and title text cannot close the attribute or open an expression', () => {
		const { body } = compile(
			tree_of({ src: './harbor.jpg', alt: 'He said "hi" {x} <b>', title: 'a & b }' })
		);
		expect(body).toContain('alt="He said &quot;hi&quot; &#123;x&#125; &lt;b>"');
		expect(body).toContain('title="a &amp; b &#125;"');
	});

	test('a name with a space is imported by its real name, not its URL-encoded one', () => {
		const { lines } = compile(tree_of({ src: './my%20photo.jpg', alt: '' }));
		expect(lines).toContain('import __og_md_image_0 from "./my photo.jpg?og-image";');
	});

	test('a non-ASCII name is imported by its real name, not its URL-encoded one', () => {
		const { lines } = compile(tree_of({ src: './caf%C3%A9.jpg', alt: '' }));
		expect(lines).toContain('import __og_md_image_0 from "./café.jpg?og-image";');
	});

	test('a path whose escapes are not UTF-8 fails with a coded message, not a URIError', () => {
		expect(() => compile(tree_of({ src: './a%FF.jpg', alt: '' }))).toThrow(
			/image_path_malformed|could not be decoded/
		);
	});

	test('a missing local image fails the build, naming it', () => {
		expect(() => compile(tree_of({ src: './nope.jpg', alt: '' }))).toThrow(
			/'\.\/nope\.jpg' does not exist/
		);
	});

	test('a raw HTML <img> naming a local file fails the build, pointing at ![]()', () => {
		for (const value of [
			'<img src="./harbor.jpg" alt="x">',
			"<p><img alt='y' src=harbor.jpg /></p>"
		]) {
			const tree: Hast = { type: 'root', children: [{ type: 'raw', value }] };
			expect(() => bridge().rehype()(tree, { filename: post })).toThrow(/!\[alt\]\(/);
		}
	});

	test('a raw HTML <img> of a remote or site-absolute file is left alone', () => {
		const value = '<img src="https://example.com/a.jpg"><img src="/static/a.jpg">';
		const tree: Hast = { type: 'root', children: [{ type: 'raw', value }] };
		bridge().rehype()(tree, { filename: post });
		expect(tree.children![0]!.value).toBe(value);
	});

	test('a remote or site-absolute image is left as a plain <img>', () => {
		for (const src of ['https://example.com/a.jpg', '/static/a.jpg']) {
			const tree = tree_of({ src, alt: '' });
			bridge().rehype()(tree, { filename: post });
			expect(tree.children![0]!.children![0]!.tagName).toBe('img');
		}
	});

	test('a body image and a frontmatter URL on a listed host become descriptors; an unlisted one stays plain', () => {
		const ext = markdown_extension({ remote: { hosts: ['images.example.com'] } })!;
		const rehype = ext.rehype[0].plugin;
		const listed = tree_of({ src: 'https://images.example.com/a.jpg', alt: 'A' });
		rehype()(listed, { filename: post });
		expect(listed.children![0]!.value).toMatch(/^<!--og-image:/);
		const raw = listed.children![1]!.children![0]!;
		expect(raw.type).toBe('raw');
		expect(raw.value).toMatch(/^<Og__Img of=\{__og_md_image_0\} alt="A"/);
		const other = tree_of({ src: 'https://cdn.other.com/a.jpg', alt: '' });
		rehype()(other, { filename: post });
		expect(other.children![0]!.children![0]!.tagName).toBe('img');

		const code = `<!--og-image:${Buffer.from(JSON.stringify([])).toString('base64url')}-->export const metadata = {"cover":"https://images.example.com/c.jpg","link":"https://cdn.other.com/c.jpg"};\n`;
		const out = ext.finish(code, post);
		expect(out.code).toContain(
			'export const metadata = {"cover":__og_fm_image_0,"link":"https://cdn.other.com/c.jpg"};'
		);
		const spec = /import __og_fm_image_0 from "([^"?]+)\?og-image"/.exec(out.lines.join('\n'))![1]!;
		expect(url_of_remote_src(spec)).toBe('https://images.example.com/c.jpg');
		expect(out.files).toEqual([]);
	});

	test('image() offers the extension on its Vite plugin api, and markdown: false offers none', () => {
		const offer = (o: Parameters<typeof image>[0]) =>
			image(o)
				.map((p) => (p.api as Record<string, unknown> | undefined)?.[EXTENSION_API])
				.filter(Boolean);
		expect(offer({})).toHaveLength(1);
		expect(offer({ markdown: false })).toEqual([]);
	});

	test('a markdown snippet (no file of its own) naming a local image fails with its own code, not image_not_found', () => {
		const tree = tree_of({ src: './harbor.jpg', alt: '' });
		expect(() => bridge().rehype()(tree, { filename: 'og-md-snippet.md' })).toThrow(
			/image_markdown_no_file/
		);
	});
});
