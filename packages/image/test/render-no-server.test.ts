// A server render with no image server registered (no `ogygia()` server half, so nothing signs)
// names no file at all: every source kind says image_no_server, a remote or card one included,
// instead of shipping its original address.
import { expect, test, vi } from 'vitest';

vi.mock('virtual:ogygia-image/config', () => ({
	default: {
		paths: { base: '', assets: '', app_dir: '_app' },
		presets: {},
		formats: ['webp'],
		breakpoints: [640],
		warmed: false
	}
}));

const { file_url } = await import('../src/render.ts');

test('on a server with no image server, a local, a remote and a card recipe are each image_no_server', () => {
	for (const recipe of [
		{
			id: 'l',
			src: '/_app/immutable/assets/a.jpg',
			width: 10,
			height: 10,
			format: 'webp' as const
		},
		{
			id: 'r',
			src: 'https://cms.example.com/a.jpg',
			width: 10,
			height: 10,
			format: 'webp' as const,
			from: 'remote' as const
		},
		{
			id: 'c',
			src: '',
			width: 10,
			height: 10,
			format: 'png' as const,
			from: 'card' as const,
			card: 'Card/e30'
		}
	])
		expect(() => file_url(recipe, false), recipe.id).toThrow(/image_no_server/);
});
