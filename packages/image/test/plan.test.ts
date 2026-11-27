import fs from 'node:fs';
import sharp from 'sharp';
import { beforeAll, describe, expect, test } from 'vitest';
import { plan_image, settle } from '../src/vite/plan.ts';
import { encode, encode_recipe } from '../src/pixels.ts';
import { placeholder_style } from '../src/placeholder.ts';
import { source_id } from '../src/source-id.ts';
import { canvas_gif, header_png, make_images } from './fixtures.ts';

let img: Awaited<ReturnType<typeof make_images>>;
beforeAll(async () => {
	img = await make_images();
});

describe('plan_image', () => {
	test('a photo: its shown size, its format and a placeholder, and no file encoded', async () => {
		const plan = await plan_image(img.jpg, settle({}, {}));
		expect([plan.width, plan.height, plan.format, plan.animated]).toEqual([
			2400,
			1600,
			'jpeg',
			false
		]);
		expect(plan.ph).toMatch(/^data:image\/webp;base64,/);
		expect(Object.keys(plan).sort()).toEqual(['animated', 'format', 'height', 'id', 'ph', 'width']);
	});

	test("the placeholder is a tiny WebP made at build, its data URL at most 400 bytes, in the image's shape", async () => {
		const w = 1200;
		const h = 800;
		const noise = Buffer.alloc(w * h * 3);
		for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
		const noisy = `${img.dir}/noise.png`;
		await sharp(noise, { raw: { width: w, height: h, channels: 3 } })
			.png()
			.toFile(noisy);
		for (const file of [img.jpg, noisy]) {
			const plan = await plan_image(file, settle({}, {}));
			expect(plan.ph!.length).toBeLessThanOrEqual(400);
			const bytes = Buffer.from(plan.ph!.split(',')[1]!, 'base64');
			const meta = await sharp(bytes).metadata();
			expect(meta.format).toBe('webp');
			expect(meta.width).toBe(16);
			expect(meta.height).toBe(Math.round((16 * plan.height) / plan.width));
		}
	});

	test('the placeholder paints as a background with no decode at render', () => {
		const url = 'data:image/webp;base64,UklGRg==';
		expect(placeholder_style(url)).toBe(
			`background-image:url(${url});background-size:cover;background-repeat:no-repeat`
		);
		expect(placeholder_style(undefined)).toBe('');
	});

	test("the id names the file's bytes alone: other settings keep the id and get their own plan", async () => {
		const a = await plan_image(img.jpg, settle({}, {}));
		const b = await plan_image(img.jpg, settle({}, {}));
		const c = await plan_image(img.jpg, settle({}, { placeholder: false }));
		expect(a.id).toBe(b.id);
		expect(c.id).toBe(a.id);
		expect(a.ph).toBeDefined();
		expect(c.ph).toBeUndefined();
		expect(a.id).toBe(await source_id(fs.readFileSync(img.jpg)));
	});

	test('two files with the same bytes are one source: the descriptor, not the plan, names the file', async () => {
		const twin = `${img.jpg.slice(0, img.jpg.lastIndexOf('/'))}/Twin Copy.jpg`;
		fs.copyFileSync(img.jpg, twin);
		const a = await plan_image(img.jpg, settle({}, {}));
		const b = await plan_image(twin, settle({}, {}));
		expect(b).toEqual(a);
	});

	test('a transparent image gets no placeholder: the blur would show through it', async () => {
		const plan = await plan_image(img.alpha, settle({}, {}));
		expect(plan.ph).toBeUndefined();
	});

	test('placeholder: false makes none', async () => {
		const plan = await plan_image(img.small, settle({}, { placeholder: false }));
		expect(plan.ph).toBeUndefined();
	});

	test('an animated GIF is planned as moving, and its WebP keeps every frame', async () => {
		const plan = await plan_image(img.gif, settle({}, {}));
		expect([plan.animated, plan.format, plan.width, plan.height]).toEqual([true, 'gif', 320, 240]);
		const out = await encode(
			fs.readFileSync(img.gif),
			{ width: 160, height: 120, format: 'webp' },
			true
		);
		const meta = await sharp(out, { animated: true }).metadata();
		expect([meta.format, meta.pages, meta.width, meta.pageHeight]).toEqual(['webp', 3, 160, 120]);
	});

	test('a long screen recording (1200×800, 300 frames) plans, and its WebP keeps every frame', async () => {
		const gif = canvas_gif(`${img.dir}/recording.gif`, 1200, 800, 300);
		const plan = await plan_image(gif, settle({}, {}));
		expect([plan.animated, plan.width, plan.height]).toEqual([true, 1200, 800]);
		const out = await encode_recipe(fs.readFileSync(gif), {
			width: 600,
			height: 400,
			format: 'webp'
		});
		const meta = await sharp(out, { animated: true }).metadata();
		expect([meta.pages, meta.width, meta.pageHeight]).toEqual([300, 600, 400]);
	}, 30_000);

	test('an animation whose frames add up past what an encode may read fails at build with a code naming the file', async () => {
		const gif = canvas_gif(`${img.dir}/huge-recording.gif`, 2048, 2048, 1100);
		await expect(plan_image(gif, settle({}, {}))).rejects.toThrow(
			/huge-recording\.gif: the image is too large[\s\S]*1100 frames/
		);
	});

	test('a still image past the pixel limit fails at build with a code naming the file', async () => {
		const png = header_png(`${img.dir}/huge-still.png`, 20000, 20000);
		await expect(plan_image(png, settle({}, {}))).rejects.toThrow(
			/huge-still\.png: the image is too large/
		);
	});

	test('an SVG is planned at its own size, never rasterized', async () => {
		const plan = await plan_image(img.svg, settle({}, {}));
		expect([plan.format, plan.width, plan.height, plan.ph]).toEqual(['svg', 120, 60, undefined]);
	});

	test('EXIF orientation is applied: a portrait stored sideways reports its shown size', async () => {
		const plan = await plan_image(img.rotated, settle({}, {}));
		expect([plan.width, plan.height]).toEqual([200, 300]);
		const out = await encode(
			fs.readFileSync(img.rotated),
			{ width: 200, height: 300, format: 'webp' },
			false
		);
		const meta = await sharp(out).metadata();
		expect([meta.width, meta.height]).toEqual([200, 300]);
	});

	test('a quarter-turn rotate op swaps the shown size', async () => {
		const plan = await plan_image(img.jpg, settle({}, { ops: { rotate: 90 } }));
		expect([plan.width, plan.height]).toEqual([1600, 2400]);
	});

	test('a file is encoded at its box in its format, cut to the box', async () => {
		const bytes = fs.readFileSync(img.jpg);
		const wide = await encode(bytes, { width: 640, height: 427, format: 'avif' }, false);
		expect(
			await sharp(wide)
				.metadata()
				.then((m) => [m.format, m.width, m.height])
		).toEqual(['heif', 640, 427]);
		const square = await encode(bytes, { width: 320, height: 320, format: 'webp' }, false);
		expect(
			await sharp(square)
				.metadata()
				.then((m) => [m.width, m.height])
		).toEqual([320, 320]);
	});

	test('an image whose header reads but whose pixels do not fails with its code', async () => {
		const whole = fs.readFileSync(img.jpg);
		const cut = `${img.dir}/cut.jpg`;
		fs.writeFileSync(cut, whole.subarray(0, Math.floor(whole.length / 3)));
		await expect(plan_image(cut, settle({}, {}))).rejects.toThrow(/could not be read/);
	});

	test('a file that is not an image fails with its code', async () => {
		fs.writeFileSync(`${img.dir}/broken.png`, 'not a png');
		await expect(plan_image(`${img.dir}/broken.png`, settle({}, {}))).rejects.toThrow(
			/could not be read/
		);
	});
});
