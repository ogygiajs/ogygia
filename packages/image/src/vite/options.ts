/**
 * The options: the plugin's (`image({ … })`: formats, ladder, quality, presets, markdown) and one
 * source's own (`import.meta.og.image(src, { … })`: what belongs to the source itself). Both are plain
 * JSON, checked here, so a typo fails the build instead of being ignored.
 *
 * @packageDocumentation
 */
import type { ImageOps } from '../descriptor.ts';
import { parse_aspect, type ImagePreset, type OutputFormat } from '../config.ts';
import { OgygiaError } from '../messages.ts';
import { is_media_condition, MEDIA_RULE } from '../layout.ts';
import { POSITIONS } from '../recipe.ts';
import { HOSTS_RULE, is_host_entry } from '../remote-hosts.ts';
import type { Encoder } from './encoder.ts';

export type { ImageOps } from '../descriptor.ts';
export type { ImageLayout, ImagePosition, ImagePreset, OutputFormat } from '../config.ts';

/** One source's options: what belongs to the file, whatever page shows it. */
export interface ImageOptions {
	/** Encoder quality, 1–100, for every file made from this source. Default: 60 for AVIF, 80 for
	 *  the others. */
	quality?: number;
	/** Paint a blur placeholder until the image arrives. Default `true` (never for a transparent
	 *  image or an SVG). */
	placeholder?: boolean;
	/** Pixel operations, applied before any resize or crop. */
	ops?: ImageOps;
	/** Make these presets' files at build (`'cover'`, or `['cover', 'thumb']`), for a page rendered
	 *  on a live server: `<Img preset="cover">` of this source then names static files the build
	 *  made instead of asking the endpoint. A prerendered page needs none: its render asks already. */
	warm?: string | string[];
	/** The image's dark file (`'./chart-dark.png'`, relative to this file), shown when the visitor's
	 *  theme is dark. It must have the same shape, so the page keeps its box when the theme flips. */
	dark?: string;
	/** The designer's other files, by the media condition each is shown at
	 *  (`{ '(max-width: 600px)': './hero-tall.jpg' }`), each with its own shape and box. */
	art?: Record<string, string>;
}

/** How the app writes its theme, as two CSS selectors that match the root when each theme is
 *  chosen (`{ dark: ':root[data-theme="dark"]', light: ':root[data-theme="light"]' }`). */
export interface ImageTheme {
	dark: string;
	light: string;
}

/** Where the build may fetch images from, and how much it takes. */
export interface ImageRemote {
	/** The hosts the app takes images from: `'images.example.com'`, `'*.cdn.example.com'` (every
	 *  name below it), with a port when not the default; `https://` only, unless an entry starts
	 *  with `http://` (`'http://127.0.0.1:4100'`). Any other URL fails the build
	 *  (`image_remote_host`), and stays a plain `<img>` in markdown. */
	hosts: string[];
	/** The most bytes one image may have. Default 20 MB (`20_000_000`). */
	maxBytes?: number;
	/** How long one fetch may take, in ms, its redirects and body included. Default `10_000`. */
	timeout?: number;
	/** How long, in seconds, a file made on request from a URL known only at request may be kept.
	 *  Default one day (`86_400`). */
	maxAge?: number;
}

/** The plugin's options: every image's defaults, the presets, and markdown's. */
export interface ImagePluginOptions {
	quality?: number;
	/** The formats to offer, best first. Default `['avif', 'webp']`. An animated image is offered as
	 *  animated WebP whatever this says. */
	formats?: OutputFormat[];
	placeholder?: boolean;
	/** The width ladder a responsive image is offered at (capped at the image's own width; a step
	 *  within a tenth of a width the layout names is left out). Default
	 *  `[320, 480, 640, 960, 1280, 1600, 2048]`. */
	breakpoints?: number[];
	/** Named ways to show an image, chosen with `<Img preset="…">` (own props say over them):
	 *  `{ thumb: { width: 400, aspect: '1/1' }, cover: { layout: 'fullWidth', aspect: '16/9',
	 *  priority: true } }`. A markdown body image uses `prose` when there is one. */
	presets?: Record<string, ImagePreset>;
	/** Markdown images (with `@ogygia/content`): `width` is the prose column's width, in CSS pixels,
	 *  when there is no `prose` preset; `animated` names the preset a moving image (an animated GIF
	 *  or WebP) takes instead, with its own width and `sizes`; `false` leaves markdown images as
	 *  plain `<img>`. Default `{}` (each image as wide as itself). */
	markdown?: { width?: number; animated?: string } | false;
	/** Who makes the image files, and what URL names each: an encoder from `@ogygia/image/vite`, or
	 *  a list in order of priority: the first that can make a file makes it (`[vercel(), sharp()]`).
	 *  A list holds one platform, at most one encoder that makes files at the endpoint, and
	 *  `sharp()` only last; any other fails the build. Default `sharp()`: the app's own endpoint makes every live file. A
	 *  prerendered page's files are made by the build, with sharp, whatever this says. */
	encoder?: Encoder | Encoder[];
	/** An app with a theme switch: the selectors its dark and light themes are written by. A
	 *  source with a dark file then renders two `<picture>`s, and the plugin's stylesheet shows the
	 *  dark one when the dark selector matches, or when the system prefers dark and the light
	 *  selector does not. Without it, the system's setting alone picks. */
	theme?: ImageTheme;
	/** Images on other hosts: `import.meta.og.image('https://images.example.com/a.jpg')`, and in
	 *  markdown a body image or frontmatter URL on a listed host. Each is fetched at build into
	 *  the build cache, asked again on every build (an unchanged one is not downloaded again), and
	 *  from there it is a file of the app's own. */
	remote?: ImageRemote;
}

export { DEFAULT_BREAKPOINTS, DEFAULT_FORMATS } from '../config.ts';

const OUTPUT_FORMATS: ReadonlySet<string> = new Set(['avif', 'webp', 'png', 'jpeg']);
const LAYOUTS: ReadonlySet<string> = new Set(['constrained', 'fullWidth', 'fixed']);
const OP_KEYS: ReadonlySet<string> = new Set([
	'rotate',
	'flip',
	'flop',
	'grayscale',
	'blur',
	'sharpen',
	'normalize',
	'negate',
	'gamma',
	'tint',
	'modulate'
]);
const IMAGE_KEYS: ReadonlySet<string> = new Set([
	'quality',
	'placeholder',
	'ops',
	'warm',
	'dark',
	'art'
]);
const PLUGIN_KEYS: ReadonlySet<string> = new Set([
	'quality',
	'formats',
	'placeholder',
	'breakpoints',
	'presets',
	'markdown',
	'encoder',
	'theme',
	'remote'
]);
const REMOTE_KEYS: ReadonlySet<string> = new Set(['hosts', 'maxBytes', 'timeout', 'maxAge']);
const ART_KEYS: ReadonlySet<string> = new Set(['media', 'aspect', 'position', 'width']);
const THEME_KEYS: ReadonlySet<string> = new Set(['dark', 'light']);
// oxlint-disable-next-line ogygia/one-markup-walk -- not markup: it refuses a CSS selector that could close the theme stylesheet's rule
const SELECTOR_RE = /^[^{};<>]+$/;
const ENCODER_NAMES: ReadonlySet<string> = new Set(['sharp', 'cloudflare', 'vercel']);
const PRESET_KEYS: ReadonlySet<string> = new Set([
	'layout',
	'width',
	'height',
	'aspect',
	'position',
	'sizes',
	'priority',
	'placeholder',
	'morph',
	'quality',
	'formats',
	'art'
]);
const MARKDOWN_KEYS: ReadonlySet<string> = new Set(['width', 'animated']);
const PRESET_NAME_RE = /^[A-Za-z][\w-]*$/;

function unknown_keys(where: string, value: object, known: ReadonlySet<string>): void {
	for (const key of Object.keys(value))
		if (!known.has(key))
			throw new OgygiaError('image_option_unknown', {
				where,
				key,
				known: [...known].join(', ')
			});
}

function invalid(where: string, key: string, rule: string): never {
	throw new OgygiaError('image_option_invalid', { where, key, rule });
}

function is_object(o: unknown): o is Record<string, unknown> {
	return o !== null && typeof o === 'object' && !Array.isArray(o);
}

function check_quality(where: string, q: unknown): void {
	if (q !== undefined && !(Number.isInteger(q) && (q as number) >= 1 && (q as number) <= 100))
		invalid(where, 'quality', 'a whole number from 1 to 100');
}

function check_formats(where: string, f: unknown): void {
	if (f === undefined) return;
	if (!Array.isArray(f) || f.length === 0 || f.some((x) => !OUTPUT_FORMATS.has(x as string)))
		invalid(where, 'formats', `a non-empty list of ${[...OUTPUT_FORMATS].join(', ')}`);
}

function check_pixels(where: string, key: string, n: unknown): void {
	if (n !== undefined && !(Number.isInteger(n) && (n as number) > 0))
		invalid(where, key, 'a whole number of pixels above 0');
}

function check_boolean(where: string, key: string, b: unknown): void {
	if (b !== undefined && typeof b !== 'boolean') invalid(where, key, 'true or false');
}

function check_encoders(where: string, e: unknown): void {
	if (e === undefined) return;
	const list: unknown[] = Array.isArray(e) ? e : [e];
	const names = list.map((x) =>
		is_object(x) && typeof x.name === 'string' && ENCODER_NAMES.has(x.name) ? x.name : null
	);
	if (!names.length || names.includes(null) || new Set(names).size !== names.length)
		invalid(
			where,
			'encoder',
			`an encoder from @ogygia/image/vite (${[...ENCODER_NAMES].map((n) => `${n}()`).join(', ')}), or a non-empty list of them, each at most once`
		);
	const rule = list_rule(list as Encoder[]);
	if (rule !== null) invalid(where, 'encoder', rule);
}

const LIST_RULE = 'a list in order of priority (the first encoder that can make a file makes it): ';

function list_rule(list: readonly Encoder[]): string | null {
	const platforms = list.filter((e) => e.name !== 'sharp');
	if (platforms.length > 1)
		return `${LIST_RULE}one platform: ${platforms.map((e) => `${e.name}()`).join(' and ')} are two`;
	const makers = list.filter((e) => e.maker !== null);
	if (makers.length > 1)
		return `${LIST_RULE}one maker: ${makers.map((e, i) => `${e.name}()${i ? '' : ' makes files'} with ${e.maker === 'binding' ? 'its Images binding' : 'sharp'}`).join(' and ')}`;
	const at = list.findIndex((e) => e.name === 'sharp');
	if (at !== -1 && at < list.length - 1)
		return `${LIST_RULE}${list[at + 1]!.name}() after sharp() is never used: sharp() makes every file`;
	return null;
}

/** Check that the plugin's and every preset's `quality` is one `vercel()` makes (`qualities`). */
export function check_qualities(opts: ImagePluginOptions, qualities: Encoder['qualities']): void {
	if (qualities === 'any') return;
	const rule = `one vercel() makes (${qualities.join(', ')}): list it in vercel({ qualities })`;
	if (opts.quality !== undefined && !qualities.includes(opts.quality))
		invalid('image()', 'quality', rule);
	for (const [name, p] of Object.entries(opts.presets ?? {}))
		if (p.quality !== undefined && !qualities.includes(p.quality))
			invalid(`image() presets.${name}`, 'quality', rule);
}

/** Check one source's options (`where` names the call in a message; `presets`, the names
 *  `image({ presets })` declares, which `warm` may name). */
export function check_image_options(
	where: string,
	o: unknown,
	presets: readonly string[] = []
): ImageOptions {
	if (o === undefined) return {};
	if (!is_object(o)) invalid(where, 'options', 'an object');
	unknown_keys(where, o, IMAGE_KEYS);
	const opts = o as ImageOptions;
	check_quality(where, opts.quality);
	check_boolean(where, 'placeholder', opts.placeholder);
	if (opts.ops !== undefined) {
		if (!is_object(opts.ops)) invalid(where, 'ops', 'an object');
		unknown_keys(`${where} ops`, opts.ops, OP_KEYS);
	}
	if (opts.dark !== undefined && !(typeof opts.dark === 'string' && opts.dark))
		invalid(where, 'dark', "the dark file's path, relative to this file ('./chart-dark.png')");
	if (opts.art !== undefined) {
		if (!is_object(opts.art) || !Object.keys(opts.art).length)
			invalid(
				where,
				'art',
				"an object of media condition → path ({ '(max-width: 600px)': './x.jpg' })"
			);
		for (const [media, file] of Object.entries(opts.art)) {
			if (!is_media_condition(media)) invalid(where, `art['${media}']`, MEDIA_RULE);
			if (!(typeof file === 'string' && file)) invalid(where, `art['${media}']`, 'a path');
		}
	}
	if (opts.warm !== undefined) {
		const names = typeof opts.warm === 'string' ? [opts.warm] : opts.warm;
		if (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== 'string'))
			invalid(where, 'warm', 'a preset name, or a non-empty list of them');
		for (const preset of names)
			if (!presets.includes(preset))
				throw new OgygiaError('image_warm_unknown', {
					where,
					preset,
					known: presets.join(', ') || '(none)'
				});
	}
	return opts;
}

/** Check one preset (`name` names it in a message). */
export function check_preset(name: string, o: unknown): ImagePreset {
	const where = `image() presets.${name}`;
	if (!is_object(o)) invalid(where, 'preset', 'an object');
	unknown_keys(where, o, PRESET_KEYS);
	const p = o as ImagePreset;
	if (p.layout !== undefined && !LAYOUTS.has(p.layout))
		invalid(where, 'layout', `one of ${[...LAYOUTS].join(', ')}`);
	check_pixels(where, 'width', p.width);
	check_pixels(where, 'height', p.height);
	if (p.aspect !== undefined && parse_aspect(p.aspect) === null)
		invalid(where, 'aspect', "a ratio above 0, like 16 / 9 or '16/9'");
	if (p.position !== undefined && !POSITIONS.has(p.position))
		invalid(where, 'position', `one of ${[...POSITIONS].join(', ')}`);
	if (p.sizes !== undefined && typeof p.sizes !== 'string') invalid(where, 'sizes', 'a string');
	check_boolean(where, 'priority', p.priority);
	check_boolean(where, 'placeholder', p.placeholder);
	check_boolean(where, 'morph', p.morph);
	check_quality(where, p.quality);
	check_formats(where, p.formats);
	if (p.art !== undefined) {
		if (!Array.isArray(p.art) || !p.art.length)
			invalid(where, 'art', 'a non-empty list of { media, aspect?, position?, width? }');
		p.art.forEach((a: unknown, i) => {
			const at = `${where} art[${i}]`;
			if (!is_object(a)) invalid(at, 'art', 'an object');
			unknown_keys(at, a, ART_KEYS);
			if (!is_media_condition(a.media)) invalid(at, 'media', MEDIA_RULE);
			check_pixels(at, 'width', a.width);
			if (a.aspect !== undefined && parse_aspect(a.aspect as number | string) === null)
				invalid(at, 'aspect', "a ratio above 0, like 16 / 9 or '16/9'");
			if (a.position !== undefined && !POSITIONS.has(a.position as string))
				invalid(at, 'position', `one of ${[...POSITIONS].join(', ')}`);
		});
	}
	return p;
}

function check_theme(where: string, t: unknown): void {
	if (t === undefined) return;
	const rule =
		'two CSS selectors, { dark: \':root[data-theme="dark"]\', light: \':root[data-theme="light"]\' }';
	if (!is_object(t)) invalid(where, 'theme', rule);
	unknown_keys(`${where} theme`, t, THEME_KEYS);
	for (const key of ['dark', 'light'])
		if (!(typeof t[key] === 'string' && SELECTOR_RE.test(t[key] as string)))
			invalid(where, `theme.${key}`, rule);
}

function check_remote(where: string, r: unknown): void {
	if (r === undefined) return;
	if (!is_object(r)) invalid(where, 'remote', `an object with hosts: ${HOSTS_RULE}`);
	unknown_keys(`${where} remote`, r, REMOTE_KEYS);
	if (!Array.isArray(r.hosts) || !r.hosts.length) invalid(where, 'remote.hosts', HOSTS_RULE);
	for (const entry of r.hosts as unknown[])
		if (!is_host_entry(entry)) invalid(where, `remote.hosts '${String(entry)}'`, HOSTS_RULE);
	if (r.maxBytes !== undefined && !(Number.isInteger(r.maxBytes) && (r.maxBytes as number) > 0))
		invalid(where, 'remote.maxBytes', 'a whole number of bytes above 0');
	if (r.timeout !== undefined && !(Number.isInteger(r.timeout) && (r.timeout as number) > 0))
		invalid(where, 'remote.timeout', 'a whole number of milliseconds above 0');
	if (r.maxAge !== undefined && !(Number.isInteger(r.maxAge) && (r.maxAge as number) >= 0))
		invalid(where, 'remote.maxAge', 'a whole number of seconds, 0 or more');
}

/** Check the plugin's options. */
export function check_plugin_options(o: unknown): ImagePluginOptions {
	const where = 'image()';
	if (o === undefined) return {};
	if (!is_object(o)) invalid(where, 'options', 'an object');
	unknown_keys(where, o, PLUGIN_KEYS);
	const opts = o as ImagePluginOptions;
	check_quality(where, opts.quality);
	check_formats(where, opts.formats);
	check_boolean(where, 'placeholder', opts.placeholder);
	if (
		opts.breakpoints !== undefined &&
		(!Array.isArray(opts.breakpoints) ||
			opts.breakpoints.length === 0 ||
			opts.breakpoints.some((b) => !(Number.isInteger(b) && b > 0)))
	)
		invalid(where, 'breakpoints', 'a non-empty list of whole numbers above 0');
	if (opts.presets !== undefined) {
		if (!is_object(opts.presets)) invalid(where, 'presets', 'an object of named presets');
		for (const [name, preset] of Object.entries(opts.presets)) {
			if (!PRESET_NAME_RE.test(name))
				invalid(
					where,
					`presets.${name}`,
					'a name of letters, digits, - and _, starting with a letter'
				);
			check_preset(name, preset);
		}
	}
	check_encoders(where, opts.encoder);
	check_theme(where, opts.theme);
	check_remote(where, opts.remote);
	if (opts.markdown !== undefined && opts.markdown !== false) {
		if (!is_object(opts.markdown)) invalid(where, 'markdown', 'an object or false');
		unknown_keys(`${where} markdown`, opts.markdown, MARKDOWN_KEYS);
		check_pixels(where, 'markdown.width', opts.markdown.width);
		const animated = opts.markdown.animated;
		const declared = Object.keys(opts.presets ?? {});
		if (animated !== undefined && !(typeof animated === 'string' && declared.includes(animated)))
			invalid(
				where,
				'markdown.animated',
				`the name of a preset image({ presets }) declares (declared: ${declared.join(', ') || '(none)'})`
			);
	}
	return opts;
}
