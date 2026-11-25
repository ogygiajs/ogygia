// vercel(): what Vercel's optimizer can make (the capability table), how it names a file
// (`/_vercel/image?url=…&w=…&q=…`), the widths a page asks for snapped to its sizes, an encoder list
// whose first able encoder makes each recipe, and the check of the adapter's `images` config.
import { expect, test } from 'vitest';
import { CAPABILITIES, cannot } from '../src/encoders/capabilities.ts';
import { needs_of } from '../src/encoders/needs.ts';
import { VERCEL_LINKS, vercel_link } from '../src/encoders/vercel.ts';
import { DEFAULT_BREAKPOINTS, type RenderConfig } from '../src/config.ts';
import { lay_out } from '../src/layout.ts';
import { namer as resolve, type NamerPlan } from '../src/namers/resolve.ts';
import type { Recipe } from '../src/recipe.ts';
import { namer_plan, sharp, vercel, vercel_images } from '../src/vite/encoder.ts';
import { image } from '../src/vite/index.ts';
import { vercel_config_missing } from '../src/vite/vercel-config.ts';

const SRC = '/_app/immutable/assets/hero.Ab12.jpg';
const namer = (p: NamerPlan) => resolve(p, { vercel: VERCEL_LINKS });
const at = (r: Partial<Recipe>): Recipe => ({
	id: 'AAAAAAAAAAAAAAAA',
	src: SRC,
	width: 640,
	height: 360,
	format: 'avif',
	source: { format: 'jpeg' },
	...r
});

test('Vercel only resizes: no crop, no position, no operation, no named PNG or JPEG, no GIF, TIFF or animated source, no still of one', () => {
	expect(cannot('vercel')).toEqual([
		'crop',
		'position top',
		'position bottom',
		'position left',
		'position right',
		'position attention',
		'position entropy',
		'rotate quarter',
		'rotate other',
		'flip',
		'flop',
		'grayscale',
		'blur',
		'sharpen',
		'normalize',
		'negate',
		'gamma',
		'tint',
		'modulate brightness',
		'modulate saturation',
		'modulate hue',
		'modulate lightness',
		'format png',
		'format jpeg',
		'png from another format',
		'source gif',
		'source tiff',
		'animated',
		'still'
	]);
	expect(CAPABILITIES.decide({ encoder: 'vercel', need: 'format avif' })).toEqual({
		can: true,
		as: expect.stringMatching(/Accept/)
	});
});

test("a recipe's needs name the crop and a source Vercel would pass through", () => {
	expect(needs_of(at({ crop: true }))).toContain('crop');
	expect(needs_of(at({}))).not.toContain('crop');
	expect(needs_of(at({ source: { format: 'gif', animated: true } }))).toEqual(
		expect.arrayContaining(['source gif', 'animated'])
	);
	expect(needs_of(at({ source: { format: 'tiff' } }))).toContain('source tiff');
	expect(cannot('cloudflare')).not.toContain('crop');
	expect(cannot('cloudflare')).not.toContain('animated');
});

const plan_of = vercel({ sizes: [640, 960, 1280], qualities: [60, 75, 80] });

test("the link: the original's URL escaped whole, the width snapped up to a size, the quality said or the format's own", () => {
	const name = namer(namer_plan([plan_of], false));
	expect(
		[
			at({}),
			at({ width: 600, format: 'webp' }),
			at({ width: 961, quality: 75 }),
			at({ src: '/shop/_app/immutable/assets/my photo,1.Ab12.jpg' }),
			at({ src: 'https://cdn.example.com/_app/immutable/assets/hero.Ab12.jpg' })
		].map(name)
	).toMatchInlineSnapshot(`
		[
		  "/_vercel/image?url=%2F_app%2Fimmutable%2Fassets%2Fhero.Ab12.jpg&w=640&q=60",
		  "/_vercel/image?url=%2F_app%2Fimmutable%2Fassets%2Fhero.Ab12.jpg&w=640&q=80",
		  "/_vercel/image?url=%2F_app%2Fimmutable%2Fassets%2Fhero.Ab12.jpg&w=1280&q=75",
		  "/_vercel/image?url=%2Fshop%2F_app%2Fimmutable%2Fassets%2Fmy%20photo%2C1.Ab12.jpg&w=640&q=60",
		  "/_vercel/image?url=https%3A%2F%2Fcdn.example.com%2F_app%2Fimmutable%2Fassets%2Fhero.Ab12.jpg&w=640&q=60",
		]
	`);
	expect(vercel_link(at({ width: 1281 }), { sizes: [640, 1280], qualities: null })).toBeNull();
});

test('vercel() alone: a crop, an op, a width past every size or a quality it does not allow fails the render, naming the need', () => {
	const name = namer(namer_plan([plan_of], false));
	expect(() => name(at({ crop: true, position: 'top' }))).toThrow(
		/vercel\(\) cannot make .*crop[\s\S]*image_encoder_cannot/
	);
	expect(() => name(at({ ops: { grayscale: true } }))).toThrow(/grayscale/);
	expect(() => name(at({ width: 2000 }))).toThrow(/width 2000/);
	expect(() => name(at({ quality: 90 }))).toThrow(/quality 90/);
	expect(() => name(at({ format: 'jpeg' }))).toThrow(/format jpeg/);
});

test('[vercel(), sharp()]: what Vercel can make is its link, anything else the sharp endpoint makes', () => {
	const name = namer(namer_plan([plan_of, sharp()], false));
	expect(name(at({}))).toMatch(/^\/_vercel\/image\?/);
	expect(name(at({ crop: true, position: 'attention' }))).toBeNull();
	expect(name(at({ ops: { tint: '#f00' } }))).toBeNull();
	expect(name(at({ width: 2000 }))).toBeNull();
	expect(name(at({ source: { format: 'gif', animated: true } }))).toBeNull();
});

test('in dev the sharp endpoint makes every file, and vercel() alone still fails a crop there', () => {
	expect(namer(namer_plan([plan_of], true))(at({}))).toBeNull();
	expect(() => namer(namer_plan([plan_of], true))(at({ crop: true }))).toThrow(/crop/);
});

test('vercel() hands the adapter its images config; its sizes default to small sizes and the breakpoints', () => {
	expect(vercel({ sizes: [1280, 640, 640], qualities: [80, 60] }).images).toEqual({
		sizes: [640, 1280],
		qualities: [60, 80],
		formats: ['image/avif', 'image/webp'],
		domains: [],
		localPatterns: [{ pathname: '^/_app/immutable/assets/.+$', search: '' }]
	});
	const plain = vercel();
	expect(plain.images.sizes).toEqual(
		[16, 32, 48, 64, 96, 128, 256, 384, ...DEFAULT_BREAKPOINTS].sort((a, b) => a - b)
	);
	expect(plain).toMatchObject({ name: 'vercel', maker: null, widths: plain.images.sizes });
});

test("vercel() opens Vercel's optimizer no wider than the app asks: the default qualities (AVIF 60, WebP 80) only, and the app's own originals only", () => {
	const plain = vercel();
	expect(plain.images.qualities).toEqual([60, 80]);
	expect(plain.qualities).toEqual([60, 80]);
	expect(plain.images.localPatterns).toEqual([
		{ pathname: '^/_app/immutable/assets/.+$', search: '' }
	]);
});

test('a plugin or preset quality vercel() does not list fails the build, naming the list to add it to', () => {
	expect(() => image({ quality: 75, encoder: vercel() })).toThrow(
		/'quality' must be one vercel\(\) makes \(60, 80\): list it in vercel\(\{ qualities \}\)[\s\S]*\/e\/image_option_invalid/
	);
	expect(() =>
		image({ presets: { thumb: { width: 200, quality: 70 } }, encoder: [vercel(), sharp()] })
	).toThrow(/presets\.thumb[\s\S]*'quality' must be one vercel\(\) makes \(60, 80\)/);
	expect(() =>
		image({ quality: 70, encoder: [vercel({ qualities: [60, 70, 80] }), sharp()] })
	).not.toThrow();
	expect(() => image({ quality: 75 })).not.toThrow();
});

test('the adapter config check fails an images config that lets anyone ask Vercel for any quality or any path of the deployment', () => {
	const want = {
		images: IMAGES,
		formats: ['avif', 'webp'] as const,
		assets: '',
		originals: '/shop/_app/immutable/assets/',
		hosts: []
	};
	const local = [{ pathname: '^/shop/_app/immutable/assets/.+$', search: '' }];
	expect(vercel_config_missing({ ...IMAGES, localPatterns: local }, want)).toEqual([]);
	expect(vercel_config_missing({ ...IMAGES, localPatterns: undefined }, want)).toEqual([
		'localPatterns (unset: the optimizer reads any path of the deployment)'
	]);
	expect(
		vercel_config_missing({ ...IMAGES, localPatterns: [{ pathname: '^/.*$' }] }, want)
	).toEqual(['localPatterns no wider than /shop/_app/immutable/assets/ (one matches /shop/x.png)']);
	expect(
		vercel_config_missing(
			{ ...IMAGES, localPatterns: [{ pathname: '^/_app/immutable/assets/.+$' }] },
			want
		)
	).toEqual(['localPatterns for /shop/_app/immutable/assets/']);
	expect(
		vercel_config_missing({ ...IMAGES, qualities: undefined, localPatterns: local }, want)
	).toEqual(['qualities (unset: anyone may ask for any quality from 1 to 100)']);
});

test('vercel() refuses an unknown key, sizes that are not whole pixels, and qualities outside 1–100', () => {
	expect(() => vercel({ size: [640] } as never)).toThrow(/image_option_unknown/);
	expect(() => vercel({ sizes: [] })).toThrow(/sizes/);
	expect(() => vercel({ sizes: [64.5] })).toThrow(/image_option_invalid/);
	expect(() => vercel({ qualities: [0] })).toThrow(/qualities/);
	expect(() => vercel({ qualities: [101] })).toThrow(/qualities/);
});

const CFG: RenderConfig = {
	formats: ['avif', 'webp'],
	breakpoints: DEFAULT_BREAKPOINTS,
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: false,
	widths: [48, 96, 640, 960, 1280]
};
const HERO = {
	id: 'AAAAAAAAAAAAAAAA',
	src: SRC,
	width: 1000,
	height: 500,
	format: 'jpeg' as const
};

test('with widths, the layout asks only for those, or the whole source, each once', () => {
	const names: Recipe[] = [];
	const laid = lay_out(HERO, { width: 500 }, CFG, (r) => {
		names.push(r);
		return `${r.width}`;
	});
	expect(laid.srcset).toBe('640 640w, 1000 1000w');
	expect(names.every((r) => r.crop === undefined && r.source?.format === 'jpeg')).toBe(true);
	const fixed = lay_out(HERO, { layout: 'fixed', width: 48, height: 24 }, CFG, (r) => `${r.width}`);
	expect(fixed.srcset).toBe('48 1x, 96 2x');
	const cut = lay_out(HERO, { width: 400, aspect: 1 }, CFG, (r) => `${r.width}:${r.crop}`);
	expect(cut.srcset).toBe('500:true 500w');
});

const IMAGES = vercel({ sizes: [640, 1280], qualities: [60, 80] }).images;

test('the adapter config check names each width, quality, format and host the build names that images lacks', () => {
	const want = {
		images: IMAGES,
		formats: ['avif', 'webp'] as const,
		assets: '',
		originals: '/_app/immutable/assets/',
		hosts: []
	};
	expect(vercel_config_missing(IMAGES, want)).toEqual([]);
	expect(vercel_config_missing(undefined, want)).toEqual(['images (no images config at all)']);
	expect(
		vercel_config_missing(
			{
				sizes: [640],
				domains: [],
				qualities: [60],
				formats: ['image/avif'],
				localPatterns: IMAGES.localPatterns
			},
			want
		)
	).toEqual(['sizes 1280', 'qualities 80', 'formats image/webp']);
	expect(
		vercel_config_missing(
			{ sizes: [640, 1280], domains: [], qualities: [60, 80], localPatterns: IMAGES.localPatterns },
			{ ...want, images: vercel().images }
		)
	).toEqual(expect.arrayContaining(['formats image/avif']));
	expect(vercel_config_missing(IMAGES, { ...want, assets: 'https://cdn.example.com' })).toEqual([
		'remote host cdn.example.com'
	]);
	expect(
		vercel_config_missing(
			{ ...IMAGES, remotePatterns: [{ hostname: '^cdn\\.example\\.com$' }] },
			{ ...want, assets: 'https://cdn.example.com' }
		)
	).toEqual([]);
	expect(
		vercel_config_missing(
			{ ...IMAGES, domains: ['cdn.example.com'] },
			{ ...want, assets: 'https://cdn.example.com' }
		)
	).toEqual([]);
});

test('the adapter config check covers remote.hosts: remotePatterns reach each listed host and no other, and the line to pass has them', () => {
	const hosts = ['images.example.com', '*.cdn.example.com', 'http://127.0.0.1:4176'];
	const want = {
		images: IMAGES,
		formats: ['avif', 'webp'] as const,
		assets: '',
		originals: '/_app/immutable/assets/',
		hosts
	};
	const line = vercel_images(
		vercel({ sizes: [640, 1280], qualities: [60, 80] }),
		want.originals,
		hosts
	);
	expect(line.remotePatterns).toEqual([
		{ protocol: 'https', hostname: '^images\\.example\\.com$' },
		{ protocol: 'https', hostname: '^(?:[^.]+\\.)+cdn\\.example\\.com$' },
		{ protocol: 'http', hostname: '^127\\.0\\.0\\.1$', port: '4176' }
	]);
	expect(vercel_config_missing(line, want)).toEqual([]);
	expect(vercel_config_missing(IMAGES, want)).toEqual([
		'remotePatterns for images.example.com',
		'remotePatterns for *.cdn.example.com',
		'remotePatterns for http://127.0.0.1:4176'
	]);
	expect(
		vercel_config_missing({ ...line, remotePatterns: line.remotePatterns!.slice(1) }, want)
	).toEqual(['remotePatterns for images.example.com']);
	const wide = vercel_config_missing(
		{ ...line, remotePatterns: [...line.remotePatterns!, { hostname: '^.*$' }] },
		want
	);
	expect(wide.join('\n')).toMatch(/remotePatterns no wider than remote\.hosts/);
	expect(
		vercel_config_missing(
			{
				...line,
				remotePatterns: [{ hostname: '^images\\.example\\.com$' }, ...line.remotePatterns!.slice(1)]
			},
			want
		).join('\n')
	).toMatch(/no wider than remote\.hosts \(.*takes images\.example\.com\)/);
	expect(
		vercel_config_missing(
			{
				...line,
				remotePatterns: [
					{ protocol: 'https', hostname: '^(?:[^.]+\\.)*example\\.com$' },
					...line.remotePatterns!.slice(1)
				]
			},
			want
		).join('\n')
	).toMatch(/takes ogygia-probe\.images\.example\.com/);
});

test("a remote image's Vercel link names its whole URL, escaped", () => {
	expect(
		vercel_link(at({ src: 'https://images.example.com/a b.jpg?v=2', from: 'remote' }), {
			sizes: [640],
			qualities: null
		})
	).toBe('/_vercel/image?url=https%3A%2F%2Fimages.example.com%2Fa%20b.jpg%3Fv%3D2&w=640&q=60');
});
