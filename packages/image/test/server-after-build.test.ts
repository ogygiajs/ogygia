// The image server realm in a page Kit renders after the build has written its files: an adapter's
// SPA fallback page (adapter-static `fallback`), rendered when the adapter runs. Its URLs name the
// files the build wrote, with no mark, since nothing removes one after that; a file no prerendered
// page asked for is named by its original. Nothing is noted: no build will make it.
import fs from 'node:fs';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';

const run = vi.hoisted(() => {
	const dir = `${process.env.TMPDIR ?? '/tmp'}/og-image-after-build-${process.pid}-${Date.now()}`;
	const handoff = {
		store: `${dir}/store`,
		minted: '',
		mark: '',
		written: `${dir}/client/_app`,
		root: dir,
		renamed: { rUrlHashId: 'Bytes1' }
	};
	process.env.__OGYGIA_IMAGE_BUILD = JSON.stringify(handoff);
	return { ...handoff, dir };
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/logo.png': '/shop/_app/immutable/assets/logo.Ab12.png' },
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '/shop', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: true, dev: false }));
vi.mock('$app/server', () => ({
	read: () => {
		throw new Error('not read in this test');
	}
}));

fs.mkdirSync(`${run.written}/immutable/og`, { recursive: true });
fs.writeFileSync(`${run.written}/immutable/og/l1-48x48.webp`, 'a file the build wrote');
fs.writeFileSync(`${run.written}/immutable/og/Bytes1-64x36.webp`, 'a remote file the build wrote');

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { app, ctx } = startPlugin(server, { name: '@ogygia/image' });

const LOGO = { id: 'l1', src: '/shop/_app/immutable/assets/logo.Ab12.png' };

beforeAll(async () => {
	await server.request!(ctx(new Request('https://example.com/')));
});

describe('a page rendered after the build wrote its files (an SPA fallback)', () => {
	test('names a file the build wrote by its plain URL, with no mark, signing nothing', () => {
		const sign = vi.spyOn(app, 'sign');
		expect(mint({ ...LOGO, width: 48, height: 48, format: 'webp' }, false)).toBe(
			'/shop/_app/immutable/og/l1-48x48.webp'
		);
		expect(sign).not.toHaveBeenCalled();
		sign.mockRestore();
	});

	test("names a remoteImage()'s file by the name the build gave it (its bytes), not the remote URL", () => {
		const remote = {
			id: 'rUrlHashId',
			src: 'https://cms.example.com/a.jpg',
			width: 64,
			height: 36,
			format: 'webp' as const,
			from: 'remote' as const
		};
		expect(mint(remote, false)).toBe('/shop/_app/immutable/og/Bytes1-64x36.webp');
	});

	test('names its original for a file no prerendered page asked for, and notes nothing', () => {
		expect(mint({ ...LOGO, width: 96, height: 96, format: 'avif' }, false)).toBe(LOGO.src);
		expect(fs.readdirSync(run.dir).sort()).toEqual(['client']);
	});
});
