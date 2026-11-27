// What `<Img>` and `getImage()` ask the server realm for: a file the build made when the request is
// exactly a warmed preset's, a signed URL for anything else; with no server realm (the browser), the
// build's file under the app folder.
import { expect, test, vi } from 'vitest';

vi.mock('virtual:ogygia-image/config', () => ({
	default: {
		formats: ['avif', 'webp'],
		breakpoints: [320, 640],
		presets: { thumb: { width: 200, aspect: '1/1' }, cover: { layout: 'fullWidth' } },
		paths: { base: '/shop', assets: '', app_dir: '_app' },
		warmed: true
	}
}));

const { getImage } = await import('../src/render.ts');
const { set_minter, recipe_head } = await import('../src/recipe.ts');
set_minter((r, built) => `/${built ? 'built' : 'signed'}/${recipe_head(r)}`);

const OF = {
	id: 'p1',
	src: '/shop/_app/immutable/assets/p.B1.jpg',
	width: 800,
	height: 1000,
	format: 'jpeg' as const,
	warm: ['thumb']
};
const files = (srcset: string | undefined) =>
	(srcset ?? '').split(', ').map((c) => c.split(' ')[0]);

test('a warmed preset asks the server for the files the build made', () => {
	const laid = getImage(OF, { preset: 'thumb' });
	for (const url of [...files(laid.srcset), ...files(laid.sources[0]!.srcset), laid.src])
		expect(url).toMatch(/^\/built\/p1-\d+x\d+$/);
});

test('with no server realm, a warmed preset names the files the build made, under the app folder at the base', () => {
	set_minter(null);
	try {
		const laid = getImage(OF, { preset: 'thumb' });
		for (const url of [...files(laid.srcset), ...files(laid.sources[0]!.srcset), laid.src])
			expect(url).toMatch(/^\/shop\/_app\/immutable\/og\/p1-\d+x\d+\.(avif|webp)$/);
	} finally {
		set_minter((r, built) => `/${built ? 'built' : 'signed'}/${recipe_head(r)}`);
	}
});

test('the same preset said over, another preset, or a source not warmed with it, is signed', () => {
	for (const laid of [
		getImage(OF, { preset: 'thumb', width: 300 }),
		getImage(OF, { preset: 'cover' }),
		getImage({ ...OF, warm: undefined }, { preset: 'thumb' })
	])
		for (const url of files(laid.srcset)) expect(url).toMatch(/^\/signed\//);
	for (const url of files(getImage(OF, { preset: 'thumb', sizes: '50vw' }).srcset))
		expect(url).toMatch(/^\/built\//);
});
