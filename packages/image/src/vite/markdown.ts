/**
 * Markdown images, for `@ogygia/content`: a local `![alt](./harbor.jpg)` renders through `<Img>`, and
 * a frontmatter value that is a path to a local image (`cover: ./cover.jpg`) becomes a descriptor. A
 * body image or frontmatter URL on a host `image({ remote: { hosts } })` lists does too (fetched at
 * build, ./remote.ts); one on any other host stays a plain `<img>` or string.
 *
 * The two packages do not import each other. The image plugin offers a markdown extension on its
 * Vite plugin object (`api.ogygiaMarkdown`); `content()` holds it for as long as the config lists the
 * plugin, and its markdown preprocessor runs `rehype` inside mdsvex and `finish` on mdsvex's output.
 * With no image plugin listed (or `markdown: false`) nothing is offered, and markdown images stay
 * plain `<img>`.
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { next_any_tag, tag_name } from '@ogygia/core/contract';
import { image_specifier } from './macro.ts';
import { RemoteHosts } from '../remote-hosts.ts';
import { is_listed, REMOTE_PREFIX, remote_src } from './remote.ts';
import { OgygiaError } from '../messages.ts';
import type {
	MARKDOWN_EXTENSION_API,
	MarkdownExtension,
	MarkdownFinish
} from '@ogygia/compiler/vite';
import type { ImagePluginOptions } from './options.ts';

/** The rehype step: local `<img>` elements → `<Og__Img>`. */
export type ImageRehype = () => (
	tree: HastNode,
	file: { path?: string; filename?: string }
) => void;

/** The markdown extension content reads (compiler's `MarkdownExtension`, the one contract both
 *  packages compile against). */
export interface ImageMarkdownExtension extends MarkdownExtension<{
	enforce: 'pre';
	plugin: ImageRehype;
}> {
	/** One rehype entry, before content's own element overrides. */
	rehype: readonly [{ enforce: 'pre'; plugin: ImageRehype }];
	/** After mdsvex: frontmatter image paths → descriptors. Returns the module-script lines to add,
	 *  whether the body now renders `<Og__Img>` (so it is a component, not static HTML), and every
	 *  image file the document names (a kept compile whose file is gone is compiled again). */
	finish: (code: string, filename: string) => MarkdownFinish & { files: string[] };
}

/** The Vite plugin `api` key content reads a markdown extension from. */
export const EXTENSION_API: typeof MARKDOWN_EXTENSION_API = 'ogygiaMarkdown';

type HastNode = {
	type?: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
};

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|avif|gif|svg|tiff?)$/i;
const NOT_LOCAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;
const IMPORTS_RE = /<!--og-image:([A-Za-z0-9_-]*)-->/;
const METADATA_RE = /export const metadata = (\{.*?\});(?=\s*(?:\n|<\/script>|$))/s;
const COMPONENT = 'Og__Img';

function is_local_image(src: string): boolean {
	return IMAGE_EXT_RE.test(src.split(/[?#]/)[0]!) && !NOT_LOCAL_RE.test(src);
}

function is_frontmatter_image(value: string): boolean {
	return (value.startsWith('./') || value.startsWith('../')) && IMAGE_EXT_RE.test(value);
}

function attr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;')
		.replace(/</g, '&lt;');
}

function path_of_url(filename: string, src: string): string {
	const bare = src.split(/[?#]/)[0]!;
	try {
		return decodeURI(bare);
	} catch {
		throw new OgygiaError('image_path_malformed', { file: path.basename(filename), src });
	}
}

function local_specifier(filename: string, rel: string, shown: string): string {
	if (!path.isAbsolute(filename)) throw new OgygiaError('image_markdown_no_file', { src: shown });
	if (!fs.existsSync(path.resolve(path.dirname(filename), rel)))
		throw new OgygiaError('image_not_found', { file: path.basename(filename), src: shown });
	return rel.startsWith('.') ? rel : `./${rel}`;
}

function refuse_html_images(filename: string, html: string): void {
	if (!/<img/i.test(html)) return;
	for (let tag = next_any_tag(html, 0); tag !== null; tag = next_any_tag(html, tag.next)) {
		if (tag_name(html, tag) !== 'img') continue;
		const src = tag.attr('src');
		if (src !== undefined && is_local_image(src))
			throw new OgygiaError('image_markdown_html', { file: path.basename(filename), src });
	}
}

let code_hash: string | undefined;

function shipped_code(): string {
	if (code_hash !== undefined) return code_hash;
	let top = path.dirname(fileURLToPath(import.meta.url));
	while (!fs.existsSync(path.join(path.dirname(top), 'package.json'))) {
		const up = path.dirname(top);
		if (up === top) break;
		top = up;
	}
	const h = crypto.createHash('sha256');
	for (const rel of fs.readdirSync(top, { recursive: true, encoding: 'utf8' }).sort()) {
		const p = path.join(top, rel);
		if (!fs.statSync(p).isFile()) continue;
		h.update(rel);
		h.update('\0');
		h.update(fs.readFileSync(p));
		h.update('\0');
	}
	return (code_hash = h.digest('base64url').slice(0, 16));
}

/** The markdown extension `image(opts)` offers content, or `null` with `markdown: false`. */
export function markdown_extension(opts: ImagePluginOptions): ImageMarkdownExtension | null {
	if (opts.markdown === false) return null;
	const hosts = opts.remote ? new RemoteHosts(opts.remote.hosts) : null;
	const width = opts.markdown?.width;
	const animated = opts.markdown?.animated;
	const still = opts.presets?.prose ? 'prose' : undefined;
	const shown = (name: string): string => {
		if (animated === undefined) {
			if (still) return ` preset="${still}"`;
			return width === undefined ? '' : ` width={${width}}`;
		}
		const moving = `${name}.animated`;
		const preset = ` preset={${moving} ? ${JSON.stringify(animated)} : ${still ? JSON.stringify(still) : 'undefined'}}`;
		return still || width === undefined
			? preset
			: `${preset} width={${moving} ? undefined : ${width}}`;
	};
	const key = `${shipped_code()}:${JSON.stringify(opts)}`;
	const rehype: ImageRehype = () => (tree, file) => {
		const filename = file.filename ?? file.path;
		if (!filename) return;
		const imports: [string, string][] = [];
		const visit = (node: HastNode): void => {
			const children = node.children;
			if (!children) return;
			for (let i = 0; i < children.length; i++) {
				const child = children[i]!;
				if (child.type === 'raw' && child.value) refuse_html_images(filename, child.value);
				const src = child.properties?.src;
				if (
					child.type === 'element' &&
					child.tagName === 'img' &&
					typeof src === 'string' &&
					(is_local_image(src) || is_listed(src, hosts))
				) {
					const name = `__og_md_image_${imports.length}`;
					const spec = is_local_image(src)
						? image_specifier(local_specifier(filename, path_of_url(filename, src), src))
						: image_specifier(remote_src(new URL(src).href));
					imports.push([name, spec]);
					const alt = typeof child.properties?.alt === 'string' ? child.properties.alt : '';
					const title = child.properties?.title;
					const extra = typeof title === 'string' ? ` title="${attr(title)}"` : '';
					children[i] = {
						type: 'raw',
						value: `<${COMPONENT} of={${name}} alt="${attr(alt)}"${extra}${shown(name)} />`
					};
				} else visit(child);
			}
		};
		visit(tree);
		if (imports.length) {
			const payload = Buffer.from(JSON.stringify(imports)).toString('base64url');
			(tree.children ??= []).unshift({ type: 'raw', value: `<!--og-image:${payload}-->` });
		}
	};
	return {
		name: '@ogygia/image',
		cache_key: () => key,
		rehype: [{ enforce: 'pre', plugin: rehype }],
		finish: (code, filename) => {
			const lines: string[] = [];
			const files: string[] = [];
			const file_of = (spec: string): string =>
				path.resolve(path.dirname(filename), spec.slice(0, spec.lastIndexOf('?')));
			const found = IMPORTS_RE.exec(code);
			if (found) {
				code = code.slice(0, found.index) + code.slice(found.index + found[0].length);
				const imports = JSON.parse(Buffer.from(found[1]!, 'base64url').toString('utf8')) as [
					string,
					string
				][];
				lines.push(`import ${COMPONENT} from '@ogygia/image/Img.svelte';`);
				for (const [name, spec] of imports) {
					lines.push(`import ${name} from ${JSON.stringify(spec)};`);
					if (!spec.startsWith(REMOTE_PREFIX)) files.push(file_of(spec));
				}
			}
			const meta = METADATA_RE.exec(code);
			if (meta) {
				let data: unknown;
				try {
					data = JSON.parse(meta[1]!);
					// oxlint-disable-next-line ogygia/no-silent-failures -- not JSON: mdsvex wrote something else, and frontmatter images are only read from its JSON form
				} catch {
					return { code, lines, dynamic: found !== null, files };
				}
				let n = 0;
				const names: string[] = [];
				const emit = (value: unknown): string => {
					if (typeof value === 'string' && is_frontmatter_image(value)) {
						const spec = image_specifier(local_specifier(filename, value, value));
						const name = `__og_fm_image_${n++}`;
						names.push(name);
						lines.push(`import ${name} from ${JSON.stringify(spec)};`);
						files.push(file_of(spec));
						return name;
					}
					if (typeof value === 'string' && is_listed(value, hosts)) {
						const spec = image_specifier(remote_src(new URL(value).href));
						const name = `__og_fm_image_${n++}`;
						names.push(name);
						lines.push(`import ${name} from ${JSON.stringify(spec)};`);
						return name;
					}
					if (Array.isArray(value)) return `[${value.map(emit).join(',')}]`;
					if (value !== null && typeof value === 'object')
						return `{${Object.entries(value)
							.map(([k, v]) => `${JSON.stringify(k)}:${emit(v)}`)
							.join(',')}}`;
					return JSON.stringify(value);
				};
				const js = emit(data);
				if (names.length)
					code = `${code.slice(0, meta.index)}export const metadata = ${js};${code.slice(meta.index + meta[0].length)}`;
			}
			return { code, lines, dynamic: found !== null, files };
		}
	};
}
