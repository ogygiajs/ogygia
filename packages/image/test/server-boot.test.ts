import { expect, test, vi } from 'vitest';

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/a.jpg': '/_app/immutable/assets/a.Ab12.jpg' },
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));

function native_libraries(): string[] {
	const report = process.report.getReport() as unknown as { sharedObjects: string[] };
	return report.sharedObjects.filter((s) => /sharp|vips/i.test(s));
}

test('starting the image server realm loads no sharp or libvips, so a server without them boots', async () => {
	expect(native_libraries()).toEqual([]);
	await import('../src/server.ts');
	expect(native_libraries()).toEqual([]);
});
