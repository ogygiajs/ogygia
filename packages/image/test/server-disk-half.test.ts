// The image server realm on a live server: what it reads and notes on disk is loaded in dev and in
// the build only, so a server bundle for a runtime with no file system never runs it.
import { expect, test, vi } from 'vitest';

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/a.jpg': '/_app/immutable/assets/a.Ab12.jpg' },
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('../src/on-disk.ts', () => {
	throw new Error('a live server loaded the realm module disk half');
});

test('a live server starts the image server realm without loading its disk half', async () => {
	const { default: server } = await import('../src/server.ts');
	expect(Object.keys(server)).toContain('request');
});
