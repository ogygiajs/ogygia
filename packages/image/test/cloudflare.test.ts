// cloudflare(): what it can make (the capability table), how it names a file (an Image
// Transformations link) and how its binding maker makes one, and the render's resolution over both.
import crypto from 'node:crypto';
import sharp, { type Sharp } from 'sharp';
import { expect, test } from 'vitest';
import { check, dead_fields, table } from '@ogygia/machine/testing';
import { CAPABILITIES, cannot } from '../src/encoders/capabilities.ts';
import {
	CLOUDFLARE_LINKS,
	cloudflare_link,
	cloudflare_steps,
	STEPS_VERSION,
	type CloudflareSteps
} from '../src/encoders/cloudflare.ts';
import { NEEDS, needs_of } from '../src/encoders/needs.ts';
import { namer as resolve, type NamerPlan } from '../src/namers/resolve.ts';
import type { Recipe } from '../src/recipe.ts';
import { cloudflare, namer_plan, sharp as sharp_encoder } from '../src/vite/encoder.ts';

const SRC = '/_app/immutable/assets/hero.Ab12.jpg';
const namer = (p: NamerPlan) => resolve(p, { cloudflare: CLOUDFLARE_LINKS });
const at = (r: Partial<Recipe>): Recipe => ({
	id: 'AAAAAAAAAAAAAAAA',
	src: SRC,
	width: 640,
	height: 360,
	format: 'avif',
	...r
});

test('the capability table, row by row', () => {
	expect(table(CAPABILITIES)).toMatchSnapshot();
	expect(dead_fields(CAPABILITIES)).toEqual([]);
	check(CAPABILITIES, {
		'sharp makes every need': (r) => !('plan' in r) || r.input.encoder !== 'sharp' || r.plan.can
	});
});

test('Cloudflare cannot make an entropy crop, a turn off the quarters, normalize, negate, gamma, tint, a hue or lightness change, or read an AVIF; its links cannot name a PNG', () => {
	const both = [
		'position entropy',
		'rotate other',
		'normalize',
		'negate',
		'gamma',
		'tint',
		'modulate hue',
		'modulate lightness'
	];
	expect(cannot('cloudflare')).toEqual([...both, 'source avif']);
	expect(cannot('cloudflare links')).toEqual([...both, 'png from another format', 'source avif']);
	expect(cannot('sharp')).toEqual([]);
});

test("a recipe's needs: the box, where it keeps, each op, the format", () => {
	expect(needs_of(at({}))).toEqual(['box', 'position center', 'format avif']);
	expect(
		needs_of(
			at({
				format: 'webp',
				position: 'entropy',
				ops: { rotate: -90, flop: true, blur: 2, modulate: { hue: 30, brightness: 1.1 } }
			})
		)
	).toEqual([
		'box',
		'position entropy',
		'rotate quarter',
		'flop',
		'blur',
		'modulate brightness',
		'modulate hue',
		'format webp'
	]);
	expect(needs_of(at({ ops: { rotate: 45 } }))).toContain('rotate other');
	for (const n of needs_of(at({ position: 'centre' }))) expect(NEEDS).toContain(n);
});

test('the link of each recipe shape, options in one fixed order', () => {
	expect(
		[
			at({}),
			at({ format: 'webp', quality: 70, position: 'top' }),
			at({ format: 'png' }),
			at({ format: 'png', quality: 90 }),
			at({ format: 'jpeg', position: 'attention' }),
			at({ ops: { rotate: 270, flip: true, grayscale: true, sharpen: true, blur: 400 } }),
			at({ ops: { modulate: { brightness: 1.2, saturation: 0.5 } } }),
			at({ src: 'https://cdn.example.com/_app/immutable/assets/hero.Ab12.jpg' }),
			at({ src: '/shop/_app/immutable/assets/my%20photo.Ab12.jpg' })
		].map(cloudflare_link)
	).toMatchInlineSnapshot(`
		[
		  "/cdn-cgi/image/width=640,height=360,fit=cover,quality=60,format=avif/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover,gravity=top,quality=70,format=webp/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover,quality=90/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover,gravity=auto,quality=80,format=jpeg/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover,quality=60,format=avif,rotate=270,flip=v,saturation=0,blur=250,sharpen=1/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover,quality=60,format=avif,saturation=0.5,brightness=1.2/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover,quality=60,format=avif/https://cdn.example.com/_app/immutable/assets/hero.Ab12.jpg",
		  "/cdn-cgi/image/width=640,height=360,fit=cover,quality=60,format=avif/shop/_app/immutable/assets/my%20photo.Ab12.jpg",
		]
	`);
});

test("the binding makes the same recipe in steps, in sharp's order: mirror, turn, box, tone", () => {
	expect(
		cloudflare_steps(
			at({ position: 'bottom', ops: { rotate: 90, flip: true, flop: true, grayscale: true } })
		)
	).toEqual({
		transforms: [
			{ flip: 'hv' },
			{ rotate: 90 },
			{ width: 640, height: 360, fit: 'cover', gravity: 'bottom' },
			{ saturation: 0 }
		],
		output: { format: 'image/avif', quality: 60 }
	});
});

test('a remote source is never made larger than it is, by a link or the binding: its box is fit=crop, which only shrinks', () => {
	const remote = at({ src: 'https://cms.example.com/a.jpg', from: 'remote' });
	expect(cloudflare_link(remote)).toBe(
		'/cdn-cgi/image/width=640,height=360,fit=crop,quality=60,format=avif/https://cms.example.com/a.jpg'
	);
	expect(cloudflare_steps(remote).transforms).toEqual([{ width: 640, height: 360, fit: 'crop' }]);
	expect(cloudflare_link(at({}))).toContain('fit=cover');
});

const STEPS_SEEN: Readonly<Record<number, string>> = {
	1: 'z8r-8rj-IvGXF8prEjKkqZMiRU8swCF8Q95YXL_Bt9A'
};

test("a change to the binding's steps bumps STEPS_VERSION, so the Worker cache never answers with files made the old way", () => {
	const recipes = [
		at({}),
		at({ format: 'png', position: 'top' }),
		at({ format: 'webp', quality: 70, position: 'attention' }),
		at({ ops: { rotate: 90, flip: true, flop: true, grayscale: true, blur: 3, sharpen: true } }),
		at({ ops: { modulate: { brightness: 1.2, saturation: 0.5 } } })
	];
	const print = crypto
		.createHash('sha256')
		.update(JSON.stringify(recipes.map(cloudflare_steps)))
		.digest('base64url');
	expect(STEPS_SEEN[STEPS_VERSION]).toBe(print);
	expect(new Set(Object.values(STEPS_SEEN)).size).toBe(Object.keys(STEPS_SEEN).length);
});

async function by_steps(src: Buffer, steps: CloudflareSteps): Promise<Buffer> {
	let bytes = src;
	for (const t of steps.transforms) {
		let img = sharp(bytes);
		if (t.flip) img = t.flip === 'h' ? img.flop() : t.flip === 'v' ? img.flip() : img.flip().flop();
		if (t.rotate) img = img.rotate(t.rotate);
		if (t.width) img = img.resize({ width: t.width, height: t.height, fit: 'cover' });
		if (t.blur) img = img.blur(t.blur / 2);
		if (t.sharpen) img = img.sharpen();
		bytes = await img.png().toBuffer();
	}
	return bytes;
}

async function spread(bytes: Buffer): Promise<number> {
	return (await sharp(bytes).stats()).channels[0]!.stdev;
}

test('the binding blurs and sharpens the box it made, as sharp does: a big source blurred and cut is as soft as sharp makes it', async () => {
	const side = 2000;
	const raw = Buffer.alloc(side * side);
	for (let y = 0; y < side; y++)
		for (let x = 0; x < side; x++) raw[y * side + x] = ((x / 40) ^ (y / 40)) & 1 ? 255 : 0;
	const src = await sharp(raw, { raw: { width: side, height: side, channels: 1 } })
		.png()
		.toBuffer();
	const recipe = at({ width: 100, height: 100, format: 'png', ops: { blur: 3 } });
	const made_by_sharp = await sharp(src)
		.blur(3)
		.resize({ width: 100, height: 100, fit: 'cover' })
		.png()
		.toBuffer();
	const sharp_spread = await spread(made_by_sharp);
	const binding_spread = await spread(await by_steps(src, cloudflare_steps(recipe)));
	expect(sharp_spread).toBeLessThan(20);
	expect(Math.abs(binding_spread - sharp_spread)).toBeLessThan(5);
});

async function pixels_of(img: Sharp): Promise<string> {
	return (await img.raw().toBuffer()).toString('base64');
}

test('a link mirrors, then turns, as sharp does', async () => {
	const src = await sharp({
		create: { width: 3, height: 2, channels: 3, background: '#000' }
	})
		.composite([{ input: Buffer.from([255, 0, 0]), raw: { width: 1, height: 1, channels: 3 } }])
		.png()
		.toBuffer();
	for (const rotate of [90, 180, 270] as const)
		for (const [flip, flop] of [
			[true, false],
			[false, true]
		] as const) {
			const link = cloudflare_link(at({ ops: { rotate, flip, flop } }));
			const said = /flip=(\w+)/.exec(link)![1]!;
			const pipeline = await pixels_of(sharp(src).rotate(rotate)[flip ? 'flip' : 'flop']());
			const mirrored = await sharp(src)[said === 'v' ? 'flip' : 'flop']().png().toBuffer();
			const link_way = await pixels_of(sharp(mirrored).rotate(rotate));
			expect(link_way, `rotate ${rotate}, ${flip ? 'flip' : 'flop'}`).toBe(pipeline);
		}
});

const plan = (p: Partial<NamerPlan>): NamerPlan => ({
	encoders: 'cloudflare()',
	links: [],
	endpoint: cannot('cloudflare'),
	dev: false,
	...p
});

test('a live recipe the links can make is named by its link; else the endpoint makes it; else the render fails naming the encoder and the need', () => {
	const name = namer(plan({ links: [{ kind: 'cloudflare', cannot: cannot('cloudflare') }] }));
	expect(name(at({}))).toMatch(/^\/cdn-cgi\/image\//);
	expect(() => name(at({ position: 'entropy' }))).toThrow(
		/cloudflare\(\) cannot make .*position entropy/
	);
	expect(() => name(at({ ops: { tint: '#f00' } }))).toThrow(/image_encoder_cannot/);
	const endpoint = namer(plan({}));
	expect(endpoint(at({ position: 'attention', ops: { rotate: 90 } }))).toBeNull();
	expect(() => endpoint(at({ ops: { normalize: true } }))).toThrow(/normalize/);
});

test("in dev every file is the endpoint's, and a need the encoder cannot meet fails there as in production", () => {
	const name = namer(
		plan({ dev: true, links: [{ kind: 'cloudflare', cannot: cannot('cloudflare') }] })
	);
	expect(name(at({}))).toBeNull();
	expect(() => name(at({ ops: { gamma: 2 } }))).toThrow(/gamma/);
});

test('cloudflare() links by default; links: false sends every file to the binding endpoint; sharp() links nothing and makes everything', () => {
	expect(namer_plan([cloudflare()], false)).toEqual({
		encoders: 'cloudflare()',
		links: [{ kind: 'cloudflare', cannot: cannot('cloudflare links') }],
		endpoint: cannot('cloudflare'),
		dev: false
	});
	expect(namer_plan([cloudflare({ links: false })], true).links).toEqual([]);
	expect(cloudflare({ binding: 'PICS' })).toMatchObject({ maker: 'binding', binding: 'PICS' });
	expect(namer_plan([sharp_encoder()], false)).toEqual({
		encoders: 'sharp()',
		links: [],
		endpoint: [],
		dev: false
	});
});

test("Cloudflare reads no AVIF source (Enterprise plans only), and its links name no PNG: a PNG from a PNG source keeps the source's format, from any other it is the binding's", () => {
	expect(needs_of(at({ source: { format: 'avif' } }))).toContain('source avif');
	expect(needs_of(at({ format: 'png', source: { format: 'png' } }))).not.toContain(
		'png from another format'
	);
	expect(needs_of(at({ format: 'png', source: { format: 'jpeg' } }))).toContain(
		'png from another format'
	);
	const name = namer(namer_plan([cloudflare()], false));
	expect(name(at({ format: 'png', source: { format: 'png' } }))).toBe(
		'/cdn-cgi/image/width=640,height=360,fit=cover/_app/immutable/assets/hero.Ab12.jpg'
	);
	expect(name(at({ format: 'png', source: { format: 'jpeg' } }))).toBeNull();
	expect(() => name(at({ source: { format: 'avif' } }))).toThrow(
		/cloudflare\(\) cannot make .*source avif[\s\S]*image_encoder_cannot/
	);
	expect(() =>
		namer(namer_plan([cloudflare({ links: false })], false))(at({ source: { format: 'avif' } }))
	).toThrow(/source avif/);
});

test('cloudflare() refuses an unknown key, a links that is not a boolean, and a binding that is no name', () => {
	expect(() => cloudflare({ link: true } as never)).toThrow(/image_option_unknown/);
	expect(() => cloudflare({ links: 'yes' } as never)).toThrow(/links/);
	expect(() => cloudflare({ binding: '1MAGES' })).toThrow(/binding/);
	expect(() => cloudflare({ binding: 'MY IMAGES' })).toThrow(/image_option_invalid/);
});
