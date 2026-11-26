// The live endpoint reads a card's image of the build the way it reads any original: by the URL
// Kit's read() takes for its tail, not by the URL the card's markup wrote (in dev a descriptor's src
// carries a query, `?no-inline`, that read() refuses).
import { expect, test, vi } from 'vitest';

const ASSETS: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map([
	['src/lib/images/avatar.jpg', new Uint8Array([0xff, 0xd8, 0xff, 1])],
	['_app/immutable/assets/logo.Ab12.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])]
]);

vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '/base', assets: '', app_dir: '_app' } }
}));
vi.mock('virtual:ogygia-image/cards', () => ({ engine: true, card_module: () => null }));
vi.mock('virtual:ogygia-image/maker', () => ({ fit: null }));
vi.mock('$app/environment', () => ({ building: false, dev: true }));
vi.mock('virtual:ogygia-image/sources', () => ({
	default: {
		'src/lib/images/avatar.jpg': '/base/src/lib/images/avatar.jpg?no-inline',
		'src/lib/images/logo.png': '/base/_app/immutable/assets/logo.Ab12.png'
	},
	remote: []
}));
vi.mock('$app/server', () => ({
	read: (asset: string) => {
		const file = asset.replace(/^\/base\//, '');
		const bytes = ASSETS.get(file);
		if (bytes === undefined) throw new Error(`Asset does not exist: ${file}`);
		return new Response(bytes);
	}
}));

const { endpoint_images } = await import('../src/cards/read.ts');

test("a card's image of the build is read by the URL read() takes for its tail, with no query, whatever query the markup's URL or dev's import carries", async () => {
	const read = endpoint_images(null);
	expect([...(await read('/base/src/lib/images/avatar.jpg?no-inline'))]).toEqual([
		0xff, 0xd8, 0xff, 1
	]);
	expect([...(await read('/base/_app/immutable/assets/logo.Ab12.png'))]).toEqual([
		0x89, 0x50, 0x4e, 0x47
	]);
});
