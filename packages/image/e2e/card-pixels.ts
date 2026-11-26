import fs from 'node:fs';
import sharp from 'sharp';
import { MARK_RGB } from './app/remote-host.ts';

type Rgb = readonly [number, number, number];

const AVATAR = new URL('./app/src/lib/images/avatar.jpg', import.meta.url);
const AVATAR_POINTS: readonly (readonly [number, number])[] = [
	[40, 40],
	[100, 100],
	[160, 150]
];
const MARK_POINT = [350, 150] as const;
const ROUNDING = 20;

async function rgb_at(bytes: Buffer): Promise<(x: number, y: number) => Rgb> {
	const { data, info } = await sharp(bytes)
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return (x, y) => {
		const at = (y * info.width + x) * info.channels;
		return [data[at]!, data[at + 1]!, data[at + 2]!];
	};
}

function near(a: Rgb, b: Rgb): boolean {
	return a.every((v, i) => Math.abs(v - b[i]!) <= ROUNDING);
}

/** Where the fixture's photo card (`/card/photo`, src/lib/cards/PhotoCard.svelte) as `png` does
 *  not show what it names: its avatar (an asset of the build, the card's top left 200 × 200) and
 *  the remote host's WebP mark (300 × 300 to its right). Empty when it draws both. */
export async function photo_card_misses(png: Buffer): Promise<string[]> {
	const card = await rgb_at(png);
	const avatar = await rgb_at(fs.readFileSync(AVATAR));
	const misses: string[] = [];
	for (const [x, y] of AVATAR_POINTS)
		if (!near(card(x, y), avatar(x, y)))
			misses.push(`the avatar at ${x},${y}: ${card(x, y).join(',')} for ${avatar(x, y).join(',')}`);
	const [x, y] = MARK_POINT;
	if (!near(card(x, y), MARK_RGB))
		misses.push(`the WebP at ${x},${y}: ${card(x, y).join(',')} for ${MARK_RGB.join(',')}`);
	return misses;
}
