/** Test images, made with sharp into a temp folder (no binary files in the repo). */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { source_id } from '../src/source-id.ts';

/** An animated GIF of `frames` frames on a `width` × `height` canvas, each frame one pixel drawn on
 *  it, so the file stays a few kilobytes however many pixels it decodes to (a screen recording's
 *  shape). */
export function canvas_gif(file: string, width: number, height: number, frames: number): string {
	const u16 = (n: number): number[] => [n & 255, n >> 8];
	const screen = [0x80, 0, 0, 255, 0, 0, 0, 0, 255];
	const loop = [0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0];
	const delay = [0x21, 0xf9, 4, 0x04, 10, 0, 0, 0];
	const pixel = [2, 2, 0x44, 0x01, 0];
	const out: number[] = [
		...Buffer.from('GIF89a'),
		...u16(width),
		...u16(height),
		...screen,
		...loop
	];
	for (let f = 0; f < frames; f++)
		out.push(...delay, 0x2c, ...u16(f % width), 0, 0, 1, 0, 1, 0, 0, ...pixel);
	out.push(0x3b);
	fs.writeFileSync(file, Buffer.from(out));
	return file;
}

/** A PNG whose header says `width` × `height` and that holds no pixels: what a reader of its
 *  metadata sees, without the bytes to back it. */
export function header_png(file: string, width: number, height: number): string {
	const chunk = (type: string, data: Buffer): Buffer => {
		const body = Buffer.concat([Buffer.from(type), data]);
		const out = Buffer.alloc(body.length + 8);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(zlib.crc32(body), body.length + 4);
		return out;
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	fs.writeFileSync(
		file,
		Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk('IHDR', ihdr),
			chunk('IDAT', zlib.deflateSync(Buffer.alloc(1))),
			chunk('IEND', Buffer.alloc(0))
		])
	);
	return file;
}

/** The id the macro gives the file at `file`: what a recipe of it names. */
/** The test's own sharp, linked into `root/node_modules` and listed in its package.json
 *  `dependencies`: an app that installed the encoder as the plugin asks. */
export function app_with_sharp(root: string): string {
	const sharp_dir = path.dirname(path.dirname(createRequire(import.meta.url).resolve('sharp')));
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({ name: 'app', private: true, dependencies: { sharp: '^0.35.0' } })
	);
	fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
	fs.symlinkSync(sharp_dir, path.join(root, 'node_modules', 'sharp'), 'dir');
	return root;
}

export function id_of(file: string): Promise<string> {
	return source_id(fs.readFileSync(file));
}

/** A folder of images: a wide photo-like JPEG, a transparent PNG, a small PNG, an animated GIF and
 *  an SVG. */
export async function make_images(): Promise<{
	dir: string;
	jpg: string;
	alpha: string;
	small: string;
	gif: string;
	svg: string;
	rotated: string;
}> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-test-'));
	const jpg = path.join(dir, 'Harbor Dusk.jpg');
	const w = 2400;
	const h = 1600;
	const raw = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			raw[i] = (x * 255) / w;
			raw[i + 1] = (y * 255) / h;
			raw[i + 2] = 128;
		}
	await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
		.jpeg()
		.toFile(jpg);

	const alpha = path.join(dir, 'logo.png');
	await sharp({
		create: { width: 300, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } }
	})
		.png()
		.toFile(alpha);

	const small = path.join(dir, 'icon.png');
	await sharp({
		create: { width: 400, height: 400, channels: 3, background: { r: 10, g: 120, b: 200 } }
	})
		.png()
		.toFile(small);

	// three frames stacked: sharp writes them as an animated GIF
	const gif = path.join(dir, 'spin.gif');
	const fw = 320;
	const fh = 240;
	const frames = Buffer.alloc(fw * fh * 3 * 4);
	for (let f = 0; f < 3; f++)
		for (let i = 0; i < fw * fh; i++) frames[(f * fw * fh + i) * 4 + f] = 255;
	for (let i = 3; i < frames.length; i += 4) frames[i] = 255;
	await sharp(frames, { raw: { width: fw, height: fh * 3, channels: 4, pageHeight: fh } as never })
		.gif({ loop: 0, delay: [100, 100, 100] })
		.toFile(gif);

	const svg = path.join(dir, 'mark.svg');
	fs.writeFileSync(
		svg,
		'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="teal"/></svg>'
	);

	// stored 300×200, EXIF orientation 6: shown 200×300
	const rotated = path.join(dir, 'portrait.jpg');
	await sharp({ create: { width: 300, height: 200, channels: 3, background: '#888' } })
		.jpeg()
		.withMetadata({ orientation: 6 })
		.toFile(rotated);

	return { dir, jpg, alpha, small, gif, svg, rotated };
}
