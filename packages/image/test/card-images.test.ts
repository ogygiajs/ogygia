// What satori is handed of a card's images (src/cards/images.ts): every image fitted to the card before
// the draw (a small file of huge dimensions is refused, not decoded), only `data:` bytes and `#`
// references in the tree it draws (so its own fetch is never reached, whatever its parser reads), a
// link's `href` left out, and a `data:` URL written under the type its bytes are.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CardSpec } from '../src/card.ts';
import { card_png } from '../src/cards/engine.ts';

const drawn: unknown[] = [];

vi.mock('satori', async (original) => {
	const real = (await original()) as { default: (tree: unknown, options: unknown) => unknown };
	return {
		default: (tree: unknown, options: unknown) => {
			drawn.push(tree);
			return real.default(tree, options);
		}
	};
});

const MONO = createRequire(import.meta.url).resolve(
	'@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'
);
const FONT = ((b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))(
	fs.readFileSync(MONO)
) as ArrayBuffer;

const W = 600;
const H = 315;

function spec_of(markup: string): CardSpec {
	return {
		card: 'TestCard00000000',
		file: 'src/lib/Card.svelte',
		digest: 'd1',
		width: W,
		height: H,
		fonts: [{ name: 'JetBrains Mono', weight: 500, style: 'normal', src: '/font.woff' }],
		html: () =>
			Promise.resolve(`<div style="display: flex; width: ${W}px; height: ${H}px">${markup}</div>`)
	};
}

function chunk(type: string, data: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'latin1');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

/** A PNG whose header says `width` × `height`, in a few dozen bytes: its pixels are never there. */
function png_header(width: number, height: number): Uint8Array {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([8, 2, 0, 0, 0], 8);
	return new Uint8Array(
		Buffer.concat([
			Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'),
			chunk('IHDR', ihdr),
			chunk('IDAT', zlib.deflateSync(Buffer.alloc(64))),
			chunk('IEND', Buffer.alloc(0))
		])
	);
}

const solid = (width: number, height: number): Promise<Buffer> =>
	sharp({ create: { width, height, channels: 3, background: '#ff0000' } })
		.png()
		.toBuffer();

/** Every image value in a tree satori was handed: `src` / `href` props and `url()` contents. */
function images_in(node: unknown, out: unknown[] = []): unknown[] {
	if (Array.isArray(node)) for (const n of node) images_in(n, out);
	else if (node !== null && typeof node === 'object' && 'props' in node) {
		const props = (node as { props: Record<string, unknown> }).props;
		for (const [key, value] of Object.entries(props)) {
			if (key === 'children') images_in(value, out);
			else if (key === 'src' || key === 'href' || key === 'xlinkHref') out.push(value);
			else if (key === 'style' && value !== null && typeof value === 'object')
				for (const v of Object.values(value))
					if (typeof v === 'string') for (const m of v.matchAll(/url\(([^)]*)\)/g)) out.push(m[1]);
		}
	}
	return out;
}

function bytes_of(value: unknown): Buffer {
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	const m = /^data:[^,]*;base64,(.*)$/s.exec(String(value));
	if (m === null) throw new Error(`not image bytes: ${String(value).slice(0, 40)}`);
	return Buffer.from(m[1]!, 'base64');
}

afterEach(() => {
	drawn.length = 0;
	vi.restoreAllMocks();
});

describe("a card's images, as satori is handed them", () => {
	test('a small file of huge dimensions (a 20000 x 20000 PNG header) is refused, coded, before anything decodes it', async () => {
		const bomb = png_header(20000, 20000);
		expect(bomb.byteLength).toBeLessThan(200);
		await expect(
			card_png(
				spec_of('<img src="https://cms.example.com/a.png" style="width: 10px; height: 10px">'),
				{},
				[FONT],
				() => Promise.resolve(bomb)
			)
		).rejects.toMatchObject({
			code: 'image_card_source',
			message: expect.stringMatching(/20000 × 20000 pixels/)
		});
		expect(drawn).toEqual([]);
	});

	test('an image larger than the card reaches satori fitted to it: covering the card, at most four times its pixels', async () => {
		const big = await solid(8000, 4000);
		await card_png(
			spec_of(
				'<img src="https://cms.example.com/a.png" style="width: 600px; height: 315px"><div style="display: flex; width: 10px; height: 10px; background-image: url(https://cms.example.com/a.png)"></div>'
			),
			{},
			[FONT],
			() => Promise.resolve(new Uint8Array(big))
		);
		const images = images_in(drawn[0]);
		expect(images).toHaveLength(2);
		for (const value of images) {
			const meta = await sharp(bytes_of(value)).metadata();
			expect(meta.width * meta.height).toBeLessThanOrEqual(4 * W * H);
			expect(meta.width).toBeGreaterThanOrEqual(W);
			expect(meta.height).toBeGreaterThanOrEqual(H);
			expect(meta.width / meta.height).toBeCloseTo(2, 1);
		}
	});

	test("an <img> hands satori its bytes, not a data: text (satori keeps every data: text it is given, up to 500 of them, for the process's life)", async () => {
		const small = await solid(8, 8);
		await card_png(
			spec_of('<img src="https://cms.example.com/a.png" style="width: 10px; height: 10px">'),
			{},
			[FONT],
			() => Promise.resolve(new Uint8Array(small))
		);
		expect(images_in(drawn[0])[0]).toBeInstanceOf(ArrayBuffer);
	});

	test("a style's url( with no closing paren is refused, coded, and satori never calls fetch", async () => {
		const fetched = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(() => Promise.reject(new Error('satori fetched')));
		for (const style of [
			'background-image: url(https://93.184.215.14/a.png',
			'background-image: url(  "https://93.184.215.14/a.png"',
			'mask-image: url(https://93.184.215.14/m.png'
		])
			await expect(
				card_png(
					spec_of(`<div style="display: flex; width: 10px; height: 10px; ${style}"></div>`),
					{},
					[FONT]
				)
			).rejects.toMatchObject({ code: 'image_card_source' });
		expect(fetched).not.toHaveBeenCalled();
		expect(drawn).toEqual([]);
	});

	test("a link's href (a card made from page markup) is no image: never read, and the card draws", async () => {
		const asked: string[] = [];
		const png = await card_png(
			spec_of('<a href="/about" style="display: flex">About</a>'),
			{},
			[FONT],
			(src) => {
				asked.push(src);
				return Promise.reject(new Error('read'));
			}
		);
		expect(asked).toEqual([]);
		expect((await sharp(png).metadata()).format).toBe('png');
		expect(images_in(drawn[0])).toEqual([]);
	});

	test('a data: URL reaches satori under the type its bytes are, not the one it declares', async () => {
		const small = await solid(8, 8);
		const declared = `data:image/svg+xml;base64,${small.toString('base64')}`;
		await card_png(
			spec_of(
				`<div style="display: flex; width: 10px; height: 10px; background-image: url(${declared})"></div>`
			),
			{},
			[FONT]
		);
		const [value] = images_in(drawn[0]);
		expect(String(value)).toMatch(/^data:image\/png;base64,/);
	});
});
