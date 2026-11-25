// The image package's hot paths: laying out a page of images (every `<Img>` render on the server
// calls lay_out and placeholder_style, and names each file by its recipe), reading a recipe back (every
// image request), the markdown rewrite of a long post (the rehype step over
// its tree, then `finish` over mdsvex's output with a frontmatter cover), the macro over a module
// with many calls, and the option checks the plugin runs per image and per preset.
//
// Inputs are generated: descriptors shaped like the plan's, a post tree shaped like
// mdast-util-to-hast's, empty image files in a fixed scratch folder (the macro and markdown check
// each file exists; their bytes are never read). The markdown extension is made in setup: making it
// hashes the package's own files once per process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bench } from '@bench/heisenbench/bench';
import { dedent } from '@ogygia/core/contract';
import {
	DEFAULT_BREAKPOINTS,
	DEFAULT_FORMATS,
	type ImagePreset,
	type RenderConfig
} from '../src/config.ts';
import { isImage, type ImageDescriptor } from '../src/descriptor.ts';
import { lay_out, mime_of, preset_request, same_files } from '../src/layout.ts';
import { placeholder_style } from '../src/placeholder.ts';
import { built_url, parse_recipe, recipe_path, source_tail, type Recipe } from '../src/recipe.ts';
import { image_call_edits, options_of_query, image_specifier } from '../src/vite/macro.ts';
import { markdown_extension } from '../src/vite/markdown.ts';
import { check_image_options, check_plugin_options } from '../src/vite/options.ts';

const DIR = path.join(os.tmpdir(), 'og-image-bench');
const QUERY_RE = /\?(og-image=[^"]+)/g;

/** `n` empty image files in the scratch folder, named `img-<i>.jpg`. */
function files(n: number): void {
	fs.mkdirSync(DIR, { recursive: true });
	for (let i = 0; i < n; i++) {
		const f = path.join(DIR, `img-${i}.jpg`);
		if (!fs.existsSync(f)) fs.writeFileSync(f, '');
	}
}

/** A source descriptor as the plan makes one. */
function descriptor(i: number): ImageDescriptor {
	const width = 1200 + (i % 5) * 400;
	return {
		id: `img${i}abcdefghijk`,
		src: `/_app/immutable/assets/img-${i}.B1c2D3e4.jpg`,
		width,
		height: Math.round((width * 9) / 16),
		format: 'jpeg',
		ph: 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADQAQCdASoQAAkAAUAmJaQAA3AA/v89WAAA'
	};
}

const CFG: RenderConfig = {
	formats: DEFAULT_FORMATS,
	breakpoints: DEFAULT_BREAKPOINTS,
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};
const PREFIXES: readonly string[] = ['', ''];

/** A file's URL as the minter writes one (its signature stood in for by a fixed string). */
const url = (r: Recipe): string =>
	`/__ogygia__/i/0123456789abcdef0123456789abcdef/${recipe_path(r, source_tail(r.src, PREFIXES))}`;

/** A file the build made, as `<Img>` names one when the request is a warmed preset's, or on a
 *  prerendered page. */
const built = (r: Recipe): string => built_url(CFG.paths, r);

const LAYOUTS: readonly ImagePreset[] = [
	{ layout: 'fullWidth', aspect: '16/9' },
	{ layout: 'constrained', width: 720 },
	{ layout: 'constrained' },
	{ layout: 'fixed', width: 48, height: 48 },
	{ layout: 'constrained', width: 400, aspect: 1, position: 'attention' }
];

bench(
	'lay_out: a page of forty images over every layout, each file named by its recipe (half of them warmed), with their placeholders',
	({ images }) => {
		let n = 0;
		for (let i = 0; i < images.length; i++) {
			const d = images[i]!;
			if (!isImage(d)) continue;
			const asked = LAYOUTS[i % LAYOUTS.length]!;
			const req = preset_request(asked, i % 2 ? {} : { width: 300 });
			const laid = lay_out(d, req, CFG, same_files(req, preset_request(asked)) ? built : url);
			n += laid.src.length + (laid.srcset?.length ?? 0) + laid.sources.length;
			n += placeholder_style(d.ph).length + mime_of(d.format).length;
		}
		return n;
	},
	{
		setup: () => ({ images: Array.from({ length: 40 }, (_, i) => descriptor(i)) }),
		scale: (_ctx, k) => ({ images: Array.from({ length: 40 * k }, (_, i) => descriptor(i)) })
	}
);

/** A source with twins: every third has a dark file, every fourth moves (a still is laid out). */
function twinned(i: number): ImageDescriptor {
	const d = descriptor(i);
	const dark = { ...descriptor(i + 1000), width: d.width, height: d.height };
	return {
		...d,
		...(i % 4 === 0 ? { animated: true, format: 'gif' as const } : {}),
		...(i % 3 === 0
			? { twins: [{ media: '(prefers-color-scheme: dark)', theme: 'dark' as const, of: dark }] }
			: {})
	};
}

const ART: ImagePreset = {
	layout: 'fullWidth',
	aspect: '16/9',
	art: [{ media: '(max-width: 600px)', aspect: '4/5', position: 'attention' }]
};

bench(
	'lay_out with twins: a page of twenty images with dark files, art direction and moving sources, with and without a theme',
	({ images }) => {
		let n = 0;
		for (let i = 0; i < images.length; i++) {
			const cfg = i % 2 ? CFG : { ...CFG, themed: true as const };
			const laid = lay_out(images[i]!, preset_request(i % 5 ? ART : LAYOUTS[1]!), cfg, url);
			n += laid.sources.length + laid.preloads.length + (laid.dark?.sources.length ?? 0);
		}
		return n;
	},
	{
		setup: () => ({ images: Array.from({ length: 20 }, (_, i) => twinned(i)) }),
		scale: (_ctx, k) => ({ images: Array.from({ length: 20 * k }, (_, i) => twinned(i)) })
	}
);

bench(
	'parse_recipe: the image endpoint reading a page’s worth of file paths',
	({ paths }) => {
		let n = 0;
		for (const p of paths) n += parse_recipe(p)?.width ?? 0;
		return n;
	},
	{
		setup: () => {
			const paths: string[] = [];
			for (let i = 0; i < 40; i++) {
				const laid = lay_out(descriptor(i), LAYOUTS[i % LAYOUTS.length]!, CFG, url);
				for (const c of (laid.srcset ?? '').split(', '))
					paths.push(c.split(' ')[0]!.slice('/__ogygia__/i/'.length + 33));
			}
			return { paths };
		},
		scale: (ctx, k) => ({ paths: Array.from({ length: k }, () => ctx.paths).flat() })
	}
);

type Hast = {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: Hast[];
};

/** A post's tree: paragraphs of text, every third holding a local image. */
function post_tree(paragraphs: number): Hast {
	const children: Hast[] = [];
	for (let i = 0; i < paragraphs; i++) {
		const text: Hast = { type: 'text', value: `Paragraph ${i} of the post, in plain words.` };
		const img: Hast = {
			type: 'element',
			tagName: 'img',
			properties: { src: `./img-${i % 12}.jpg`, alt: `Figure ${i}`, title: `A "title" ${i}` }
		};
		children.push({
			type: 'element',
			tagName: 'p',
			children: i % 3 === 0 ? [text, img] : [text]
		});
	}
	return { type: 'root', children };
}

/** mdsvex's module script for a post with a cover, then its body. */
function compiled(body: string): string {
	const meta = JSON.stringify({
		title: 'A post',
		cover: './img-0.jpg',
		tags: ['a', 'b'],
		gallery: [{ src: './img-1.jpg' }, { src: 'not-an-image' }]
	});
	return `${dedent`
		<script context="module">
			export const metadata = ${meta};
		</script>
	`}\n${body}`;
}

bench(
	'markdown images: the rehype step over a sixty-paragraph post, then finish with a frontmatter cover',
	({ paragraphs, post, ext }) => {
		const tree = post_tree(paragraphs);
		ext.rehype[0].plugin()(tree, { filename: post });
		let body = '';
		const walk = (n: Hast): void => {
			if (n.type === 'raw') body += n.value;
			n.children?.forEach(walk);
		};
		walk(tree);
		const done = ext.finish(compiled(body), post);
		return done.code.length + done.lines.length + ext.cache_key().length;
	},
	{
		setup: () => {
			files(12);
			const ext = markdown_extension({ markdown: { width: 720 } })!;
			return { paragraphs: 60, post: path.join(DIR, '+post.md'), ext };
		},
		scale: (ctx, k) => ({ ...ctx, paragraphs: 60 * k })
	}
);

/** A module with `calls` image calls (every fourth with options) and a glob. */
function module_source(calls: number): string {
	let src = `import { thing } from './thing';\n`;
	for (let i = 0; i < calls; i++)
		src +=
			i % 4 === 0
				? `export const a${i} = import.meta.og.image('./img-${i % 12}.jpg', { quality: 70, ops: { rotate: 90 } });\n`
				: `export const a${i} = import.meta.og.image('./img-${i % 12}.jpg');\n`;
	return src;
}

bench(
	'image macro: a module with twenty-four image calls, read and rewritten as edits',
	({ src, id }) => {
		const edits = image_call_edits(src, id);
		let n = edits.length;
		for (const e of edits)
			for (const m of e.text.matchAll(QUERY_RE)) n += Object.keys(options_of_query(m[1]!)).length;
		return n;
	},
	{
		setup: () => {
			files(12);
			return { src: module_source(24), id: path.join(DIR, 'page.ts') };
		},
		scale: (ctx, k) => ({ ...ctx, src: module_source(24 * k) })
	}
);

bench(
	'image options: the plugin options with their presets, then each image’s options and specifier',
	({ images }) => {
		const plugin = check_plugin_options({
			quality: 70,
			formats: ['avif', 'webp'],
			breakpoints: [320, 640, 960, 1280, 1920],
			presets: {
				cover: { layout: 'fullWidth', aspect: '16/9', priority: true },
				thumb: { width: 400, aspect: '1/1', position: 'attention' },
				avatar: { layout: 'fixed', width: 48, height: 48 },
				prose: { width: 720 }
			},
			markdown: { width: 720 }
		});
		let n = plugin.breakpoints?.length ?? 0;
		for (let i = 0; i < images; i++) {
			const own = check_image_options(`page.ts:${i}`, {
				quality: 50 + (i % 40),
				ops: { rotate: i % 2 ? 90 : 0, grayscale: i % 3 === 0 }
			});
			n += image_specifier(`./img-${i}.jpg`, own).length;
		}
		return n;
	},
	{ setup: () => ({ images: 40 }), scale: (_ctx, k) => ({ images: 40 * k }) }
);
