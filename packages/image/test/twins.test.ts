// Twins: other candidate sets of one image, chosen by a media condition (a moving source's still,
// art direction, a dark file). The browser takes the first `<source>` whose media matches, so the
// order lay_out writes them in is the whole rule; these tests play the browser.
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import type { RenderConfig } from '../src/config.ts';
import type { ImageDescriptor, Twin } from '../src/descriptor.ts';
import { DARK_MEDIA, lay_out, STILL_MEDIA, type Laid } from '../src/layout.ts';
import { parse_recipe, recipe_file, recipe_path, type Recipe } from '../src/recipe.ts';
import { needs_of } from '../src/encoders/needs.ts';
import { cloudflare_link, cloudflare_steps } from '../src/encoders/cloudflare.ts';
import { theme_css } from '../src/vite/theme.ts';
import { check_image_options, check_plugin_options } from '../src/vite/options.ts';

const CFG: RenderConfig = {
	formats: ['avif', 'webp'],
	breakpoints: [640, 960, 1280],
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};

const url = (r: Recipe): string =>
	`/${r.id}-${r.width}x${r.height}${r.still ? '-s' : ''}.${r.format}`;

function source(id: string, over: Partial<ImageDescriptor> = {}): ImageDescriptor {
	return { id, src: `/${id}.jpg`, width: 1600, height: 1000, format: 'jpeg', ...over };
}

/** A media state: which features hold. */
type State = Record<string, boolean>;

function split_and(media: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < media.length; i++) {
		if (media[i] === '(') depth++;
		else if (media[i] === ')') depth--;
		else if (depth === 0 && media.startsWith(' and ', i)) {
			parts.push(media.slice(from, i));
			from = i + 5;
		}
	}
	parts.push(media.slice(from));
	return parts;
}

/** Does `media` hold in `state`? The conditions lay_out writes: features, `and`, `not`. */
function holds(media: string, state: State): boolean {
	return split_and(media.trim()).every((part) => {
		const inner = part.slice(1, -1);
		if (inner.startsWith('not ')) return !holds(inner.slice(4), state);
		if (inner.includes('(')) return holds(inner, state);
		if (!(part in state)) throw new Error(`unknown feature ${part}`);
		return state[part]!;
	});
}

/** What the browser shows: the first `<source>` whose media holds, else the `<img>`. */
function picked(laid: Laid, state: State): { url: string; width: number; height: number } {
	const row = laid.sources.find((s) => s.media === undefined || holds(s.media, state));
	if (row?.media === undefined) return { url: laid.src, width: laid.width, height: laid.height };
	return {
		url: row.srcset.split(' ')[0]!,
		width: row.width ?? laid.width,
		height: row.height ?? laid.height
	};
}

const id_of = (u: string): string => u.slice(1).split('-')[0]!;
const still_of = (u: string): boolean => /-s\.\w+$/.test(u);

describe('the picked row is the one a person expects', () => {
	const art_arb = fc.record({
		own: fc.boolean(),
		aspect: fc.constantFrom('1/1', '4/5', '3/1')
	});
	test('over twin sets × media states', () => {
		fc.assert(
			fc.property(
				fc.boolean(),
				fc.boolean(),
				fc.array(art_arb, { maxLength: 3 }),
				fc.boolean(),
				fc.boolean(),
				fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
				(animated, has_dark, arts, reduce, dark, matches) => {
					const art: Twin[] = arts.map((a, i) =>
						a.own
							? { media: `(x-art${i})`, of: source(`own${i}`, { width: 900, height: 1200 }) }
							: { media: `(x-art${i})`, aspect: a.aspect }
					);
					const base = source('base', {
						...(animated ? { animated: true, format: 'gif' as const } : {}),
						...(has_dark
							? { twins: [{ media: DARK_MEDIA, theme: 'dark' as const, of: source('dark') }] }
							: {})
					});
					const laid = lay_out(base, { width: 800, art }, CFG, url);
					const state: State = {
						[STILL_MEDIA]: reduce,
						[DARK_MEDIA]: dark,
						...Object.fromEntries(matches.map((m, i) => [`(x-art${i})`, m]))
					};
					const got = picked(laid, state);
					const hit = arts.findIndex((_, i) => matches[i]);
					let want: { id: string; still: boolean; ratio: number };
					if (animated && reduce) want = { id: 'base', still: true, ratio: 1.6 };
					else if (hit !== -1) {
						const a = arts[hit]!;
						const [w, h] = a.aspect.split('/').map(Number) as [number, number];
						want = a.own
							? { id: `own${hit}`, still: false, ratio: 900 / 1200 }
							: { id: has_dark && dark ? 'dark' : 'base', still: false, ratio: w / h };
					} else want = { id: has_dark && dark ? 'dark' : 'base', still: false, ratio: 1.6 };
					expect(id_of(got.url)).toBe(want.id);
					expect(still_of(got.url)).toBe(want.still);
					expect(Math.abs(got.width / got.height - want.ratio)).toBeLessThan(0.01);

					const preloaded = laid.preloads.filter(
						(p) => p.media === undefined || holds(p.media, state)
					);
					expect(preloaded).toHaveLength(1);
					expect(id_of(preloaded[0]!.href)).toBe(want.id);
					expect(still_of(preloaded[0]!.href)).toBe(want.still);
				}
			),
			{ numRuns: 500 }
		);
	});
});

describe('twins', () => {
	test('each twin row carries its own box, so the page reserves the right space per media', () => {
		const laid = lay_out(
			source('base'),
			{
				layout: 'fullWidth',
				aspect: '16/9',
				art: [{ media: '(max-width: 600px)', aspect: '4/5' }]
			},
			CFG,
			url
		);
		expect(laid.sources.map((s) => [s.media, s.type, s.width, s.height])).toEqual([
			['(max-width: 600px)', 'image/avif', 800, 1000],
			['(max-width: 600px)', 'image/webp', 800, 1000],
			[undefined, 'image/avif', undefined, undefined]
		]);
		expect([laid.width, laid.height]).toEqual([1600, 900]);
	});

	test("an art twin's own file keeps its own shape, not the request's crop", () => {
		const tall = source('tall', { width: 600, height: 900 });
		const laid = lay_out(
			source('base'),
			{ width: 800, aspect: '16/9', art: [{ media: '(max-width: 600px)', of: tall }] },
			CFG,
			url
		);
		expect([laid.sources[0]!.width, laid.sources[0]!.height]).toEqual([600, 900]);
	});

	test('an art crop of a source with a dark file comes first as the dark file at art and dark', () => {
		const base = source('base', {
			twins: [{ media: DARK_MEDIA, theme: 'dark', of: source('dark') }]
		});
		const laid = lay_out(
			base,
			{ width: 800, art: [{ media: '(max-width: 600px)', aspect: 1 }] },
			CFG,
			url
		);
		expect([...new Set(laid.sources.map((s) => `${s.media} ${id_of(s.srcset)}`))]).toEqual([
			'(max-width: 600px) and (prefers-color-scheme: dark) dark',
			'(max-width: 600px) base',
			'(prefers-color-scheme: dark) dark',
			'undefined base'
		]);
	});

	test('with image({ theme }), a dark file is a second picture, and each preload says its scheme', () => {
		const base = source('base', {
			twins: [{ media: DARK_MEDIA, theme: 'dark', of: source('dark') }]
		});
		const laid = lay_out(base, { width: 800 }, { ...CFG, themed: true }, url);
		expect(laid.sources.every((s) => s.media === undefined)).toBe(true);
		expect(id_of(laid.src)).toBe('base');
		expect(id_of(laid.dark!.src)).toBe('dark');
		expect(laid.preloads.map((p) => p.media)).toEqual(['(not (prefers-color-scheme: dark))']);
		expect(laid.dark!.preloads.map((p) => p.media)).toEqual(['(prefers-color-scheme: dark)']);
	});

	test('a twin media that cannot be joined with another, or a twin with twins, is image_prop_invalid', () => {
		const art = (media: string): Twin[] => [{ media }];
		for (const media of ['', 'screen and (max-width: 600px)', '(a), (b)'])
			expect(() => lay_out(source('base'), { art: art(media) }, CFG, url)).toThrow(
				/image_prop_invalid/
			);
		const nested = source('own', { twins: [{ media: DARK_MEDIA, of: source('x') }] });
		expect(() =>
			lay_out(source('base'), { art: [{ media: '(max-width: 1px)', of: nested }] }, CFG, url)
		).toThrow(/a twin has no twins/);
	});
});

describe('the still', () => {
	const still: Recipe = {
		id: 'AAAA',
		src: '/spin.gif',
		width: 40,
		height: 40,
		format: 'avif',
		position: 'top',
		still: true,
		ops: { flip: true },
		source: { format: 'gif', animated: true }
	};

	test('its recipe head says -s after the position and before the ops, and reads back', () => {
		expect(recipe_file(still)).toMatch(/^AAAA-40x40-ptop-s-o[\w-]+\.avif$/);
		expect(parse_recipe(recipe_path(still, 'spin.gif'))).toMatchObject({
			still: true,
			position: 'top'
		});
		const { still: _, ...moving } = still;
		expect(recipe_file(moving)).not.toContain('-s');
		expect(parse_recipe(recipe_path(moving, 'spin.gif'))!.still).toBeUndefined();
	});

	test('it needs a still, not an animation; Cloudflare makes it with anim=false', () => {
		expect(needs_of(still)).toContain('still');
		expect(needs_of(still)).not.toContain('animated');
		expect(cloudflare_steps(still).output.anim).toBe(false);
		expect(cloudflare_link(still)).toContain(',anim=false');
	});
});

describe('options', () => {
	test("the theme stylesheet shows the dark picture by the app's selectors, or the system's when no selector says", () => {
		expect(theme_css(undefined)).toBe('');
		expect(
			theme_css({ dark: ':root[data-theme="dark"]', light: ':root[data-theme="light"]' })
		).toMatchSnapshot();
	});

	test('dark, art, theme and a preset art are checked', () => {
		expect(
			check_image_options('x', { dark: './d.png', art: { '(max-width: 1px)': './a.png' } })
		).toBeTruthy();
		expect(() => check_image_options('x', { dark: 3 })).toThrow(/image_option_invalid/);
		expect(() => check_image_options('x', { art: { screen: './a.png' } })).toThrow(
			/media condition/
		);
		expect(() => check_plugin_options({ theme: { dark: '.d' } })).toThrow(/theme.light/);
		expect(() => check_plugin_options({ theme: { dark: '.d {', light: '.l' } })).toThrow(
			/theme.dark/
		);
		expect(() =>
			check_plugin_options({ presets: { hero: { art: [{ media: '(x)', of: 1 }] as never } } })
		).toThrow(/image_option_unknown/);
		expect(
			check_plugin_options({ presets: { hero: { art: [{ media: '(x)', aspect: '4/5' }] } } })
		).toBeTruthy();
	});
});
