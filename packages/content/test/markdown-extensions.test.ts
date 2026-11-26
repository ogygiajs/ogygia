/**
 * Markdown extensions: another Vite plugin adds rehype entries and a post-mdsvex `finish` step to
 * content's markdown through its plugin object's `api.ogygiaMarkdown`. `content()` holds each offer
 * for as long as the resolved config lists it, and the preprocessor reads the live set per compile.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __set_build_cache_root } from '@ogygia/compiler';
import { ogygiaPreprocess } from '../src/markdown/index.ts';
import {
	EXTENSION_API,
	hold_markdown_extensions,
	markdown_extensions,
	type MarkdownExtension
} from '../src/markdown/extensions.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-md-extensions-'));
__set_build_cache_root(tmp);
afterAll(() => {
	__set_build_cache_root(undefined);
	fs.rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => hold_markdown_extensions([]));

type Hast = { type?: string; tagName?: string; value?: string; children?: Hast[] };

/** An extension that turns every `<em>` into a `<Shout>` component and imports it. */
function shout(salt = 'a'): MarkdownExtension {
	const rehype = () => (tree: Hast) => {
		const visit = (n: Hast): void => {
			n.children?.forEach((c, i) => {
				if (c.type === 'element' && c.tagName === 'em')
					n.children![i] = { type: 'raw', value: '<Shout />' };
				else visit(c);
			});
		};
		visit(tree);
	};
	return {
		name: 'shout',
		cache_key: () => salt,
		rehype: [{ enforce: 'pre', plugin: rehype }],
		finish: (code) => ({
			code,
			lines: code.includes('<Shout') ? [`import Shout from './Shout.svelte';`] : [],
			dynamic: code.includes('<Shout')
		})
	};
}

const plugin = (ext: unknown, name = 'x') => ({ name, api: { [EXTENSION_API]: ext } });

async function compile(filename: string, content: string): Promise<string> {
	const out = await ogygiaPreprocess({ region: true }).markup!({ content, filename });
	return (out as { code: string }).code;
}

describe('markdown extensions', () => {
	it('a plugin’s extension rewrites the body and adds its module lines', async () => {
		hold_markdown_extensions([plugin(shout())]);
		const code = await compile('/app/src/content/ext/a.md', 'Hello *there*.\n');
		expect(code).toContain('<Shout />');
		expect(code).toContain(`import Shout from './Shout.svelte';`);
	});

	it('a body the extension made dynamic is not emitted as a static region', async () => {
		const plain = await compile('/app/src/content/ext/b.md', 'Hello there.\n');
		expect(plain).toContain('{@html');
		hold_markdown_extensions([plugin(shout())]);
		const code = await compile('/app/src/content/ext/b.md', 'Hello *there*.\n');
		expect(code).not.toContain('{@html');
	});

	it('a config that no longer lists the plugin drops its extension', async () => {
		hold_markdown_extensions([plugin(shout())]);
		expect(markdown_extensions().map((e) => e.name)).toEqual(['shout']);
		hold_markdown_extensions([{ name: 'other' }]);
		expect(markdown_extensions()).toEqual([]);
		const code = await compile('/app/src/content/ext/c.md', 'Hello *there*.\n');
		expect(code).not.toContain('<Shout');
	});

	it('the extension’s cache key is part of the document’s: a new key compiles again', async () => {
		let calls = 0;
		const counted = (salt: string): MarkdownExtension => {
			const ext = shout(salt);
			const finish = ext.finish!;
			return { ...ext, finish: (c, f) => (calls++, finish(c, f)) };
		};
		hold_markdown_extensions([plugin(counted('one'))]);
		await compile('/app/src/content/ext/d.md', 'Hello *there*.\n');
		await compile('/app/src/content/ext/d.md', 'Hello *there*.\n');
		expect(calls).toBe(1);
		hold_markdown_extensions([plugin(counted('two'))]);
		await compile('/app/src/content/ext/d.md', 'Hello *there*.\n');
		expect(calls).toBe(2);
	});

	it('a file the extension’s output reads, gone since the document was kept, compiles it again so the extension says so', async () => {
		const image = path.join(tmp, 'cover.png');
		fs.writeFileSync(image, 'png');
		const reads: MarkdownExtension = {
			name: 'reads',
			cache_key: () => 'r',
			finish: (code) => {
				if (!fs.existsSync(image)) throw new Error('image_not_found: cover.png');
				return { code, lines: [], dynamic: false, files: [image] };
			}
		};
		hold_markdown_extensions([plugin(reads)]);
		await compile('/app/src/content/ext/e.md', 'Hello.\n');
		fs.rmSync(image);
		await expect(compile('/app/src/content/ext/e.md', 'Hello.\n')).rejects.toThrow(
			/image_not_found/
		);
	});

	it('one preprocessor compiles with the extensions held now, not those of its first compile', async () => {
		const tag = (name: string): MarkdownExtension => ({
			name: 'tag',
			cache_key: () => name,
			rehype: [
				{
					enforce: 'pre',
					plugin: () => (tree: Hast) => {
						tree.children?.push({ type: 'raw', value: `<i>${name}</i>` });
					}
				}
			]
		});
		const markup = ogygiaPreprocess({ region: true }).markup!;
		const run = async (filename: string) =>
			((await markup({ content: 'Hello.\n', filename })) as { code: string }).code;
		hold_markdown_extensions([plugin(tag('First'))]);
		expect(await run('/app/src/content/ext/g.md')).toContain('First');
		hold_markdown_extensions([plugin(tag('Second'))]);
		const second = await run('/app/src/content/ext/h.md');
		expect(second).toContain('Second');
		expect(second).not.toContain('First');
	});

	it('an offer content cannot read fails with a code, naming the plugin', () => {
		expect(() => hold_markdown_extensions([plugin({ name: 'half' }, 'vite-plugin-half')])).toThrow(
			/vite-plugin-half/
		);
	});
});
