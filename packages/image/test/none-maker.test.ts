// The maker of an app whose encoders make no file at its endpoint (`vercel()` alone): it encodes
// nothing, so it hands back a PNG asked for as it is (a live share card's own-size file, drawn by
// satori and resvg, which need no encoder) and refuses every other ask.
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { make } from '../src/makers/none.ts';
import type { ParsedRecipe } from '../src/recipe.ts';

const png = (width: number, height: number): Promise<Buffer> =>
	sharp({ create: { width, height, channels: 3, background: '#102a43' } })
		.png()
		.toBuffer();

const ask = (over: Partial<ParsedRecipe>): ParsedRecipe => ({
	id: 'cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
	tail: 'Card0000/e30',
	width: 120,
	height: 63,
	format: 'png',
	...over
});

test('a PNG asked for at its own size, as a PNG, is handed back as it is', async () => {
	const bytes = new Uint8Array(await png(120, 63));
	expect(await make(bytes, ask({}), undefined)).toBe(bytes);
});

test('any other ask is refused, saying no encoder makes files here', async () => {
	const bytes = new Uint8Array(await png(120, 63));
	const jpeg = new Uint8Array(
		await sharp(await png(120, 63))
			.jpeg()
			.toBuffer()
	);
	for (const [b, r] of [
		[bytes, ask({ width: 60, height: 32 })],
		[bytes, ask({ format: 'webp' })],
		[bytes, ask({ ops: { grayscale: true } })],
		[bytes, ask({ still: true })],
		[bytes, ask({ position: 'top' })],
		[jpeg, ask({})],
		[bytes.subarray(0, 20), ask({})]
	] as const)
		await expect(make(b, r, undefined)).rejects.toThrow(
			'no encoder in image({ encoder }) makes files at this server'
		);
});
