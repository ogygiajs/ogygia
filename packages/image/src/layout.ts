/**
 * Layout intent → the files to ask for and the attributes an `<img>` / `<picture>` needs. The author
 * says how the image sits on the page (`constrained`, `fullWidth`, `fixed`, a box's shape) and at most
 * a display width; the candidate files (each a recipe), the srcset, `sizes`, the width and height
 * attributes and the preload come from that, the source and the plugin's settings. Pure: the URL of
 * each recipe comes from `url`, so the component, the markdown pipeline, the benches and the tests all
 * read the same answer.
 *
 * TWINS are other candidate sets chosen by a media condition, each laid out with its own crop and
 * box, as `<source media>` rows before the format rows, in one fixed order (the browser takes the
 * first row that matches, so this order is the whole rule):
 *
 * 1. the still of a moving source (`(prefers-reduced-motion: reduce)`): its first frame;
 * 2. each art twin, the request's then the source's; one that crops the source itself, when the
 *    source has a dark twin, first as the dark file at `<media> and (prefers-color-scheme: dark)`;
 * 3. the dark twin (`(prefers-color-scheme: dark)`);
 * 4. the source's own formats.
 *
 * With `image({ theme })` the dark twin is no row: it is laid out as a picture of its own
 * (`Laid.dark`), which the plugin's stylesheet shows by the app's theme selectors.
 *
 * @packageDocumentation
 */
import type { ImageDescriptor, ImageFormat, Twin } from './descriptor.ts';
import {
	parse_aspect,
	type ImageLayout,
	type ImagePosition,
	type ImagePreset,
	type OutputFormat,
	type RenderConfig
} from './config.ts';
import { POSITIONS, SIDE_MAX, SOURCE_ID_RE, type Recipe } from './recipe.ts';
import { RenderError } from './render-messages.ts';

const PLACEHOLDER_RE = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;

export type { ImageLayout } from './config.ts';

/** What the author asks for. */
export interface LayoutRequest {
	layout?: ImageLayout;
	/** Display width in CSS pixels. */
	width?: number;
	/** Display height in CSS pixels. With `width`, the image is cropped to that box. */
	height?: number;
	/** The box's shape (`16 / 9`, `'1/1'`): the files are cropped to it. */
	aspect?: number | string;
	/** Where a crop keeps. */
	position?: ImagePosition;
	/** Replaces the derived `sizes`. Only for a layout the three intents cannot say. */
	sizes?: string;
	quality?: number;
	formats?: readonly OutputFormat[];
	/** Art direction: another crop, or another source (`of`), at another media condition. */
	art?: readonly Twin[];
}

/** One `<source>`: a candidate set, for the browsers its `media` and `type` match. */
export interface LaidSource {
	/** The media condition it is chosen by (a dark or an art-directed image), if any. */
	media?: string;
	/** Its format's MIME type, if it names one. */
	type?: string;
	srcset: string;
	/** Its own `sizes`, when not the `<img>`'s. */
	sizes?: string;
	/** Its own box, when not the `<img>`'s (a crop of another shape). */
	width?: number;
	height?: number;
}

/** One `<link rel="preload">` of a priority image: the best format of one candidate set. */
export interface LaidPreload {
	type: string;
	srcset?: string;
	sizes?: string;
	href: string;
	/** The media it is chosen at, when the image has twins: each visitor preloads only the set the
	 *  `<picture>` will pick. */
	media?: string;
}

/** What to render. */
export interface Laid {
	/** The `width` / `height` attributes: the display box, so the page reserves the space. */
	width: number;
	height: number;
	/** `<source>` elements in the order the browser tries them: the twins' rows, then the best
	 *  format first. Empty when there is one format and no twin. */
	sources: LaidSource[];
	/** The `<img>` itself: its fallback `src`, and its own `srcset` (the most compatible format). */
	src: string;
	srcset?: string;
	sizes?: string;
	/** The box has its own shape (a width and a height, or an aspect): the files are cut to it, and
	 *  the `<img>` keeps it (`aspect-ratio`, `object-fit: cover`). */
	cover: boolean;
	/** For a priority image: one preload per candidate set, each with the media it is chosen at. */
	preloads: LaidPreload[];
	/** With `image({ theme })`, the dark twin laid out as its own `<picture>`. */
	dark?: Laid;
}

const MIME: Readonly<Record<ImageFormat, string>> = {
	avif: 'image/avif',
	webp: 'image/webp',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	tiff: 'image/tiff'
};

/** The MIME type of a format. */
export function mime_of(format: ImageFormat): string {
	return MIME[format];
}

/** The media condition of a moving image's still. */
export const STILL_MEDIA = '(prefers-reduced-motion: reduce)';
/** The media condition of a dark twin. */
export const DARK_MEDIA = '(prefers-color-scheme: dark)';

const SAME_SHAPE = 0.005;
const NEAR = 1.1;

function near(a: number, b: number): boolean {
	return Math.max(a, b) / Math.min(a, b) < NEAR;
}

/** Do two shapes (width / height) differ by more than a rounding? */
export function other_shape(a: number, b: number): boolean {
	return Math.abs(a - b) / b > SAME_SHAPE;
}

function one_group(media: string): boolean {
	if (media[0] !== '(') return false;
	let depth = 0;
	for (let i = 0; i < media.length; i++) {
		if (media[i] === '(') depth++;
		else if (media[i] === ')' && --depth === 0) return i === media.length - 1;
	}
	return false;
}

function grouped(media: string): string {
	return one_group(media) ? media : `(${media})`;
}

/** Every one of the media conditions. */
export function media_and(...all: readonly string[]): string {
	return all.length === 1 ? all[0]! : all.map(grouped).join(' and ');
}

/** The negation of a media condition. */
export function media_not(media: string): string {
	return `(not ${grouped(media)})`;
}

function file_widths(
	layout: ImageLayout,
	width: number,
	widest: number,
	breakpoints: readonly number[]
): number[] {
	if (layout === 'fixed') {
		const one = Math.min(width, widest);
		const two = Math.min(width * 2, widest);
		return one === two ? [one] : [one, two];
	}
	const top = layout === 'fullWidth' ? Math.max(...breakpoints) : width * 2;
	const named =
		layout === 'fullWidth'
			? [Math.min(widest, top)]
			: [Math.min(width, widest), Math.min(top, widest)];
	const out = new Set<number>(named);
	for (const b of breakpoints)
		if (b < top && b < widest && !named.some((n) => near(b, n))) out.add(b);
	return [...out].sort((a, b) => a - b);
}

function snapped(widths: readonly number[], allowed: readonly number[], widest: number): number[] {
	const last = allowed[allowed.length - 1]!;
	const out = new Set(widths.map((w) => Math.min(widest, allowed.find((s) => s >= w) ?? last)));
	return [...out].sort((a, b) => a - b);
}

/** The request a preset makes, `own` props over it (the layout `constrained` when neither says). */
export function preset_request(p: ImagePreset, own: LayoutRequest = {}): LayoutRequest {
	return {
		layout: own.layout ?? p.layout ?? 'constrained',
		width: own.width ?? p.width,
		height: own.height ?? p.height,
		aspect: own.aspect ?? p.aspect,
		position: own.position ?? p.position,
		sizes: own.sizes ?? p.sizes,
		quality: own.quality ?? p.quality,
		formats: own.formats ?? p.formats,
		art: own.art ?? p.art
	};
}

/** Do `a` and `b` ask for the same files? (`sizes` changes no file.) */
export function same_files(a: LayoutRequest, b: LayoutRequest): boolean {
	return (
		a.layout === b.layout &&
		a.width === b.width &&
		a.height === b.height &&
		String(a.aspect) === String(b.aspect) &&
		a.position === b.position &&
		a.quality === b.quality &&
		String(a.formats) === String(b.formats) &&
		JSON.stringify(a.art ?? []) === JSON.stringify(b.art ?? [])
	);
}

function derived_sizes(layout: ImageLayout, width: number): string | undefined {
	if (layout === 'fixed') return undefined;
	if (layout === 'fullWidth') return '100vw';
	return `(min-width: ${width}px) ${width}px, 100vw`;
}

function invalid(prop: string, value: unknown, want: string): never {
	throw new RenderError('image_prop_invalid', { prop, value: String(value), want });
}

function whole_pixels(prop: string, n: number | undefined): number | undefined {
	if (n === undefined) return undefined;
	if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)
		invalid(prop, n, 'a number of pixels above 0');
	return Math.max(1, Math.round(n));
}

function at_least_one(n: number): number {
	return Math.max(1, Math.round(n));
}

interface One {
	width: number;
	height: number;
	sets: { type: string; srcset: string }[];
	src: string;
	sizes: string | undefined;
	cover: boolean;
	preload: LaidPreload;
}

function lay_one(
	image: ImageDescriptor,
	req: LayoutRequest,
	cfg: RenderConfig,
	url: (recipe: Recipe) => string,
	still: boolean
): One {
	if (!SOURCE_ID_RE.test(image.id)) invalid('of.id', image.id, 'an id the build made');
	if (image.ph !== undefined && !PLACEHOLDER_RE.test(image.ph))
		invalid('of.ph', image.ph, 'a placeholder the build made (a WebP data URL)');
	const layout = req.layout ?? 'constrained';
	const asked_width = whole_pixels('width', req.width);
	const asked_height = whole_pixels('height', req.height);
	const aspect = parse_aspect(req.aspect);
	if (req.aspect !== undefined && aspect === null)
		invalid('aspect', req.aspect, "a ratio above 0, like 16 / 9 or '16/9'");
	if (
		req.quality !== undefined &&
		!(Number.isInteger(req.quality) && req.quality >= 1 && req.quality <= 100)
	)
		invalid('quality', req.quality, 'a whole number from 1 to 100');
	if (req.position !== undefined && !POSITIONS.has(req.position))
		invalid('position', req.position, `one of ${[...POSITIONS].join(', ')}`);
	const own = image.width / image.height;
	const boxed = asked_width !== undefined && asked_height !== undefined;
	const shape = boxed ? asked_width / asked_height : aspect;
	const ratio = shape ?? own;
	const svg = image.format === 'svg';
	const crop = !svg && other_shape(ratio, own);
	if (crop && image.height * ratio < 1)
		invalid(
			boxed ? 'height' : 'aspect',
			boxed ? asked_height : req.aspect,
			`a box the source can fill: at most ${image.height} times as tall as it is wide`
		);
	const widest = crop ? Math.min(image.width, at_least_one(image.height * ratio)) : image.width;

	let width: number;
	if (layout === 'fullWidth') width = widest;
	else if (asked_width !== undefined) width = asked_width;
	else if (asked_height !== undefined) width = at_least_one(asked_height * ratio);
	else width = widest;
	if (layout === 'constrained' && !svg && !boxed) width = Math.min(width, widest);
	const height = boxed ? asked_height : at_least_one(width / ratio);
	const cover = shape !== null;

	if (svg)
		return {
			width,
			height,
			sets: [],
			src: image.src,
			sizes: undefined,
			cover,
			preload: { type: MIME.svg, href: image.src }
		};

	const moves = image.animated === true && !still;
	const formats: readonly ImageFormat[] = moves ? ['webp'] : (req.formats ?? cfg.formats);
	const quality = req.quality ?? image.quality ?? cfg.quality;
	const position =
		crop && req.position !== undefined && req.position !== 'center' && req.position !== 'centre'
			? req.position
			: undefined;
	const ladder = file_widths(layout, width, widest, cfg.breakpoints);
	const widths = cfg.widths?.length ? snapped(ladder, cfg.widths, widest) : ladder;
	const sizes = req.sizes ?? derived_sizes(layout, width);

	const widest_file = widths[widths.length - 1]!;
	if (widest_file > SIDE_MAX)
		invalid('width', req.width ?? width, `at most ${SIDE_MAX}: no image file is wider`);
	if (Math.round(widest_file / ratio) > SIDE_MAX)
		invalid('height', req.height ?? height, `at most ${SIDE_MAX}: no image file is taller`);
	const recipe = (w: number, format: ImageFormat): Recipe => ({
		id: image.id,
		src: image.src,
		width: w,
		height: Math.max(1, Math.round(w / ratio)),
		format,
		...(quality !== undefined ? { quality } : {}),
		...(position !== undefined ? { position } : {}),
		...(still ? { still: true as const } : {}),
		...(image.ops ? { ops: image.ops } : {}),
		...(crop ? { crop: true } : {}),
		source: { format: image.format, ...(image.animated ? { animated: true } : {}) }
	});
	const at_least = (format: ImageFormat, w: number): string =>
		url(recipe(widths.find((x) => x >= w) ?? widths[widths.length - 1]!, format));
	const candidates = (format: ImageFormat): string =>
		layout === 'fixed'
			? widths.map((w, i) => `${url(recipe(w, format))} ${i + 1}x`).join(', ')
			: widths.map((w) => `${url(recipe(w, format))} ${w}w`).join(', ');

	const sets = formats.map((format) => ({ type: MIME[format], srcset: candidates(format) }));
	const fallback = formats[formats.length - 1]!;
	const best = sets[0]!;
	return {
		width,
		height,
		sets,
		src: at_least(fallback, width),
		sizes,
		cover,
		preload: {
			type: best.type,
			srcset: best.srcset,
			sizes,
			href: at_least(formats[0]!, width)
		}
	};
}

interface Placed {
	media: string;
	image: ImageDescriptor;
	req: LayoutRequest;
	still: boolean;
}

function check_twin(twin: Twin, prop: string): void {
	if (twin === null || typeof twin !== 'object') invalid(prop, twin, 'an object with a media');
	if (!is_media_condition(twin.media)) invalid(`${prop}.media`, twin.media, MEDIA_RULE);
	if (twin.of?.twins?.length) invalid(`${prop}.of.twins`, 'twins', 'none: a twin has no twins');
}

/** What a twin's `media` must be, in a message. */
export const MEDIA_RULE =
	"a media condition in parentheses, like '(max-width: 600px)' (one per twin: no comma, no media type)";

/** Is `media` a media condition a twin can be chosen by (and joined with another by `and`)? */
export function is_media_condition(media: unknown): boolean {
	return typeof media === 'string' && media[0] === '(' && !media.includes(',');
}

function art_request(req: LayoutRequest, twin: Twin): LayoutRequest {
	const own_file = twin.of !== undefined && twin.theme === undefined;
	const out: LayoutRequest = { ...req, art: undefined };
	if (twin.width !== undefined) out.width = twin.width;
	if (twin.aspect !== undefined || own_file) {
		out.aspect = twin.aspect;
		out.height = undefined;
	}
	if (twin.position !== undefined) out.position = twin.position;
	return out;
}

function placed_twins(
	image: ImageDescriptor,
	req: LayoutRequest,
	cfg: RenderConfig,
	pick: 'both' | 'light' | 'dark'
): Placed[] {
	const own = image.twins ?? [];
	own.forEach((t, i) => check_twin(t, `of.twins[${i}]`));
	(req.art ?? []).forEach((t, i) => check_twin(t, `art[${i}]`));
	const dark = own.find((t) => t.theme === 'dark' && t.of !== undefined);
	const base = pick === 'dark' && dark ? dark.of! : image;
	const out: Placed[] = [];
	if (base.animated && cfg.stills !== false)
		out.push({ media: STILL_MEDIA, image: base, req: { ...req, art: undefined }, still: true });
	for (const twin of [...(req.art ?? []), ...own.filter((t) => t.theme === undefined)]) {
		const at = art_request(req, twin);
		if (twin.of !== undefined) {
			out.push({ media: twin.media, image: twin.of, req: at, still: false });
			continue;
		}
		if (pick === 'both' && dark)
			out.push({
				media: media_and(twin.media, DARK_MEDIA),
				image: dark.of!,
				req: at,
				still: false
			});
		out.push({ media: twin.media, image: base, req: at, still: false });
	}
	if (pick === 'both' && dark)
		out.push({ media: DARK_MEDIA, image: dark.of!, req: { ...req, art: undefined }, still: false });
	return out;
}

function rows_of(one: One, media: string, sizes: string | undefined): LaidSource[] {
	const own_sizes = one.sizes !== sizes && one.sizes !== undefined ? { sizes: one.sizes } : {};
	const box = { width: one.width, height: one.height };
	if (!one.sets.length) return [{ media, type: MIME.svg, srcset: one.src, ...box }];
	return one.sets.map((set) => ({ media, ...set, ...own_sizes, ...box }));
}

function lay_picture(
	image: ImageDescriptor,
	req: LayoutRequest,
	cfg: RenderConfig,
	url: (recipe: Recipe) => string,
	pick: 'both' | 'light' | 'dark',
	scheme: string | undefined
): Laid {
	const twins = placed_twins(image, req, cfg, pick);
	const base_image =
		pick === 'dark' ? (image.twins!.find((t) => t.theme === 'dark')!.of as ImageDescriptor) : image;
	const base = lay_one(base_image, { ...req, art: undefined }, cfg, url, false);
	const laid_twins = twins.map((t) => ({ t, one: lay_one(t.image, t.req, cfg, url, t.still) }));
	const nots = twins.map((t) => media_not(t.media));
	const preload = (p: LaidPreload, parts: readonly string[]): LaidPreload => {
		const all = scheme === undefined ? parts : [...parts, scheme];
		return all.length ? { ...p, media: media_and(...all) } : p;
	};
	const fallback = base.sets[base.sets.length - 1];
	return {
		width: base.width,
		height: base.height,
		sources: [
			...laid_twins.flatMap(({ t, one }) => rows_of(one, t.media, base.sizes)),
			...base.sets.slice(0, -1)
		],
		src: base.src,
		...(fallback ? { srcset: fallback.srcset, sizes: base.sizes } : {}),
		cover: base.cover,
		preloads: [
			...laid_twins.map(({ t, one }, i) => preload(one.preload, [t.media, ...nots.slice(0, i)])),
			preload(base.preload, nots)
		]
	};
}

/** Lay out `image` the way `req` asks, with the plugin's settings `cfg`; `url` names each file. A
 *  fraction of a pixel is rounded; a size, aspect or quality no file can have is `image_prop_invalid`. */
export function lay_out(
	image: ImageDescriptor,
	req: LayoutRequest,
	cfg: RenderConfig,
	url: (recipe: Recipe) => string
): Laid {
	const themed =
		cfg.themed === true && image.twins?.some((t) => t.theme === 'dark' && t.of !== undefined);
	if (!themed) return lay_picture(image, req, cfg, url, 'both', undefined);
	const light = lay_picture(image, req, cfg, url, 'light', media_not(DARK_MEDIA));
	return { ...light, dark: lay_picture(image, req, cfg, url, 'dark', DARK_MEDIA) };
}
