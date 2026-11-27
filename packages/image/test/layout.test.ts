import { describe, expect, test } from 'vitest';
import { lay_out } from '../src/layout.ts';
import { DEFAULT_BREAKPOINTS, type RenderConfig } from '../src/config.ts';
import type { ImageDescriptor } from '../src/descriptor.ts';
import { parse_recipe, recipe_path, type Recipe } from '../src/recipe.ts';

const CFG: RenderConfig = {
	formats: ['avif', 'webp'],
	breakpoints: [640, 960, 1280, 1600, 2048],
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};

function image(over: Partial<ImageDescriptor> = {}): ImageDescriptor {
	return { id: 'x', src: '/a/photo.jpg', width: 2400, height: 1600, format: 'jpeg', ...over };
}

/** A URL that spells the recipe out, so a test reads what was asked for. */
const url = (r: Recipe): string =>
	`/${r.width}x${r.height}${r.position ? `-${r.position}` : ''}${r.quality ? `-q${r.quality}` : ''}.${r.format}`;

describe('lay_out', () => {
	test('constrained with a width offers its 1× and 2× and the breakpoints under 2×', () => {
		const laid = lay_out(image(), { width: 450 }, CFG, url);
		expect(laid.width).toBe(450);
		expect(laid.height).toBe(300);
		expect(laid.sizes).toBe('(min-width: 450px) 450px, 100vw');
		expect(laid.sources).toEqual([
			{
				type: 'image/avif',
				srcset: '/450x300.avif 450w, /640x427.avif 640w, /900x600.avif 900w'
			}
		]);
		expect(laid.srcset).toBe('/450x300.webp 450w, /640x427.webp 640w, /900x600.webp 900w');
		expect(laid.src).toBe('/450x300.webp');
	});

	test('a breakpoint within a tenth of a width the layout names makes no file of its own', () => {
		const ladder = (desc: Partial<ImageDescriptor>, req: object): string[] =>
			lay_out(image(desc), req, { ...CFG, breakpoints: DEFAULT_BREAKPOINTS }, url)
				.srcset!.split(', ')
				.map((c) => c.split(' ')[1]!);
		expect(ladder({}, { width: 900 })).toEqual([
			'320w',
			'480w',
			'640w',
			'900w',
			'1280w',
			'1600w',
			'1800w'
		]);
		expect(ladder({ width: 1205, height: 499 }, { width: 900 })).toEqual([
			'320w',
			'480w',
			'640w',
			'900w',
			'1205w'
		]);
		expect(ladder({ width: 1300, height: 800 }, { layout: 'fullWidth' })).toEqual([
			'320w',
			'480w',
			'640w',
			'960w',
			'1300w'
		]);
		expect(ladder({}, { width: 600 })).toEqual(['320w', '480w', '600w', '960w', '1200w']);
	});

	test('constrained never asks for a raster wider than its pixels', () => {
		const laid = lay_out(image(), { width: 4000 }, CFG, url);
		expect([laid.width, laid.height]).toEqual([2400, 1600]);
		expect(laid.srcset?.split(', ').at(-1)).toBe('/2400x1600.webp 2400w');
	});

	test('constrained with no width is the intrinsic width', () => {
		const laid = lay_out(image(), {}, CFG, url);
		expect(laid.width).toBe(2400);
		expect(laid.sizes).toBe('(min-width: 2400px) 2400px, 100vw');
	});

	test('fullWidth offers every breakpoint at 100vw', () => {
		const laid = lay_out(image(), { layout: 'fullWidth' }, CFG, url);
		expect(laid.sizes).toBe('100vw');
		expect(laid.srcset?.split(', ')).toHaveLength(5);
	});

	test('fixed asks for exactly 1× and 2× of its box, and no sizes', () => {
		const laid = lay_out(image(), { layout: 'fixed', width: 48 }, CFG, url);
		expect([laid.width, laid.height]).toEqual([48, 32]);
		expect(laid.sizes).toBeUndefined();
		expect(laid.srcset).toBe('/48x32.webp 1x, /96x64.webp 2x');
	});

	test('a fixed square avatar from a wide photo is cut square, never wider than 2× its box', () => {
		const laid = lay_out(image(), { layout: 'fixed', width: 48, height: 48 }, CFG, url);
		expect(laid.srcset).toBe('/48x48.webp 1x, /96x96.webp 2x');
		expect(laid.cover).toBe(true);
	});

	test('a width and a height crop the files to that box', () => {
		const laid = lay_out(image(), { width: 400, height: 400 }, CFG, url);
		expect([laid.width, laid.height, laid.cover]).toEqual([400, 400, true]);
		expect(laid.sizes).toBe('(min-width: 400px) 400px, 100vw');
		expect(laid.srcset).toBe('/400x400.webp 400w, /640x640.webp 640w, /800x800.webp 800w');
		expect(laid.preloads.map((p) => p.href)).toEqual(['/400x400.avif']);
	});

	test('an aspect crops every file to that shape, no wider than the source covers', () => {
		const laid = lay_out(image(), { layout: 'fullWidth', aspect: '1/1' }, CFG, url);
		expect([laid.width, laid.height]).toEqual([1600, 1600]);
		expect(laid.srcset).toBe(
			'/640x640.webp 640w, /960x960.webp 960w, /1280x1280.webp 1280w, /1600x1600.webp 1600w'
		);
	});

	test('a crop names where it keeps; the centre is the default and goes unsaid', () => {
		expect(lay_out(image(), { width: 300, aspect: 1, position: 'top' }, CFG, url).src).toBe(
			'/300x300-top.webp'
		);
		expect(lay_out(image(), { width: 300, aspect: 1, position: 'center' }, CFG, url).src).toBe(
			'/300x300.webp'
		);
	});

	test('a position on an image whose shape is kept changes nothing', () => {
		expect(lay_out(image(), { width: 300, position: 'top' }, CFG, url).src).toBe('/300x200.webp');
	});

	test('a height alone keeps the aspect ratio', () => {
		const laid = lay_out(image(), { height: 200 }, CFG, url);
		expect([laid.width, laid.height]).toEqual([300, 200]);
	});

	test('one format renders a plain img: no sources', () => {
		const laid = lay_out(image(), { width: 600, formats: ['webp'] }, CFG, url);
		expect(laid.sources).toEqual([]);
	});

	test('an animated source moves as WebP only, with a still of its first frame for reduced motion', () => {
		const still = (r: Recipe): string => `${url(r)}${r.still ? '?still' : ''}`;
		const laid = lay_out(image({ animated: true, format: 'gif' }), { width: 600 }, CFG, still);
		expect(laid.sources.map((s) => [s.media, s.type, s.srcset.split(', ')[0]])).toEqual([
			['(prefers-reduced-motion: reduce)', 'image/avif', '/600x400.avif?still 600w'],
			['(prefers-reduced-motion: reduce)', 'image/webp', '/600x400.webp?still 600w']
		]);
		expect(laid.src).toBe('/600x400.webp');
		expect(laid.srcset).not.toContain('?still');
	});

	test('no still is offered when the encoders cannot make one', () => {
		const laid = lay_out(
			image({ animated: true, format: 'gif' }),
			{ width: 600 },
			{ ...CFG, stills: false },
			url
		);
		expect(laid.sources).toEqual([]);
	});

	test('quality: the request over the source over the plugin', () => {
		const q = { ...CFG, quality: 50 };
		expect(lay_out(image(), { width: 300 }, q, url).src).toBe('/300x200-q50.webp');
		expect(lay_out(image({ quality: 60 }), { width: 300 }, q, url).src).toBe('/300x200-q60.webp');
		expect(lay_out(image({ quality: 60 }), { width: 300, quality: 70 }, q, url).src).toBe(
			'/300x200-q70.webp'
		);
	});

	test('an authored sizes replaces the derived one', () => {
		expect(lay_out(image(), { sizes: '50vw' }, CFG, url).sizes).toBe('50vw');
	});

	test('an SVG is its own file: no srcset, no sizes, no recipe', () => {
		const svg = image({ id: 's', src: '/m.svg', width: 120, height: 60, format: 'svg' });
		const laid = lay_out(svg, { width: 240 }, CFG, () => {
			throw new Error('an SVG asks for no file');
		});
		expect([laid.src, laid.srcset, laid.sizes, laid.width]).toEqual([
			'/m.svg',
			undefined,
			undefined,
			240
		]);
	});

	test('the preload names the best format', () => {
		const laid = lay_out(image(), { layout: 'fullWidth' }, CFG, url);
		expect(laid.preloads).toHaveLength(1);
		expect(laid.preloads[0]!.type).toBe('image/avif');
		expect(laid.preloads[0]!.srcset).toContain('.avif 2048w');
		expect(laid.preloads[0]!.media).toBeUndefined();
	});
});

describe('lay_out agrees with the endpoint', () => {
	const asked: string[] = [];
	const real = (r: Recipe): string => {
		const path = recipe_path(r, 'a/photo.jpg');
		asked.push(path);
		return `/${path}`;
	};

	test.each([
		['a fractional width', { width: 1000 / 3 }],
		['a fractional fixed box', { layout: 'fixed' as const, width: 47.5, height: 31.2 }],
		['a fractional height alone', { height: 200.7 }],
		['a fractional aspect', { width: 300, aspect: 1.3333 }],
		['a width under one pixel', { width: 0.4 }],
		['a very tall aspect the source can still fill', { aspect: '1/1500' }],
		['a height far past the source, with no width', { height: 200_000 }]
	])('%s asks only for files the endpoint makes, at whole sizes', (_, req) => {
		asked.length = 0;
		const laid = lay_out(image(), req, CFG, real);
		expect(asked.length).toBeGreaterThan(0);
		for (const path of asked) expect(parse_recipe(path), path).not.toBeNull();
		expect(Number.isInteger(laid.width) && laid.width >= 1).toBe(true);
		expect(Number.isInteger(laid.height) && laid.height >= 1).toBe(true);
	});

	test.each([
		['a zero width', { width: 0 }],
		['a negative width', { width: -200 }],
		['a width that is not a number', { width: Number.NaN }],
		['an infinite height', { height: Number.POSITIVE_INFINITY }],
		['a zero aspect', { aspect: 0 }],
		['an aspect that does not read', { aspect: 'wide' }],
		['a quality that is not whole', { quality: 72.5 }],
		['a quality above 100', { quality: 101 }],
		['an aspect taller than the source can fill', { aspect: '1/100000' }],
		['a box taller than the source can fill', { width: 400, height: 2_000_000 }],
		[
			'a fixed box taller than the source can fill',
			{ layout: 'fixed' as const, width: 48, height: 200_000 }
		],
		['a crop position that is not one', { aspect: '1/1', position: 'north' as never }],
		['a position that is not one, with no crop', { position: 'north' as never }]
	])('%s is refused with a code, naming the prop', (_, req) => {
		expect(() => lay_out(image(), req, CFG, real)).toThrow(/image_prop_invalid/);
	});

	test.each([
		['an id that is not a recipe id', { id: 'x;background:url(https://example.com/p)' }],
		['an empty id', { id: '' }],
		['a placeholder that is not a WebP data URL', { ph: 'https://example.com/p.png' }],
		[
			'a placeholder that closes its url()',
			{ ph: 'data:image/webp;base64,AAAA);background:url(https://example.com/p' }
		]
	])('a descriptor from outside the build with %s is refused with a code', (_, over) => {
		expect(() => lay_out(image(over), {}, CFG, real)).toThrow(/image_prop_invalid/);
	});

	test('a source wider than any file the endpoint makes, laid out at its own width, is refused with a code', () => {
		expect(() => lay_out(image({ width: 150_000, height: 10 }), {}, CFG, real)).toThrow(
			/image_prop_invalid/
		);
		asked.length = 0;
		lay_out(image({ width: 150_000, height: 10 }), { width: 2000 }, CFG, real);
		for (const path of asked) expect(parse_recipe(path), path).not.toBeNull();
	});
});
