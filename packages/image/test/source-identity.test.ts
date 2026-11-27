// A file is named by its source's content. An original edited after a page named its files must
// never put the new pixels under the old name, in the store a build and the dev server share or in
// the build's output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import type { RenderConfig } from '../src/config.ts';

const io = vi.hoisted(() => {
	const dir = `${process.env.TMPDIR ?? '/tmp'}/og-image-identity-${process.pid}-${Date.now()}`;
	process.env.__OGYGIA_IMAGE_BUILD = JSON.stringify({ store: `${dir}/store`, minted: '' });
	return { dir, original: `${dir}/hero.jpg` };
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/hero.jpg': '/_app/immutable/assets/hero.Ab12.jpg' },
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({ read: () => new Response(fs.readFileSync(io.original)) }));

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { note_built } = await import('../src/store.ts');
const { handoff_for, write_built } = await import('../src/vite/build-files.ts');
const { plan_image } = await import('../src/vite/plan.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

const SRC = '/_app/immutable/assets/hero.Ab12.jpg';
const CFG: RenderConfig = {
	formats: ['webp'],
	breakpoints: [64],
	presets: {},
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};
const SETTINGS = { placeholder: false, ops: {} };

async function solid(file: string, r: number, g: number, b: number): Promise<void> {
	await sharp({ create: { width: 200, height: 200, channels: 3, background: { r, g, b } } })
		.jpeg()
		.toFile(file);
}

async function red_of(bytes: Uint8Array): Promise<number> {
	return (await sharp(bytes).stats()).channels[0]!.mean;
}

async function get(url: string): Promise<Response> {
	return (await server.request!(ctx(new Request(new URL(url, 'http://localhost')))))!;
}

/** A prerendered build of a page that names `id`'s 64 × 64 file, its original `bytes`: the file it
 *  writes. */
async function build_with(id: string, bytes: Buffer): Promise<Buffer> {
	const saved = process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = { ...(await handoff_for(true)), store: JSON.parse(saved!).store as string };
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-identity-out-'));
	fs.mkdirSync(path.join(out, 'client', '_app', 'immutable', 'assets'), { recursive: true });
	fs.writeFileSync(path.join(out, 'client', SRC.slice(1)), bytes);
	note_built(handoff.minted, `${id}-64x64${SRC}.webp`);
	await write_built(handoff, CFG, [], out);
	process.env.__OGYGIA_IMAGE_BUILD = saved;
	return fs.readFileSync(path.join(out, 'client', '_app', 'immutable', 'og', `${id}-64x64.webp`));
}

let red = Buffer.alloc(0);
let blue = Buffer.alloc(0);
beforeAll(async () => {
	fs.mkdirSync(io.dir, { recursive: true });
	await solid(`${io.dir}/red.jpg`, 255, 0, 0);
	await solid(`${io.dir}/blue.jpg`, 0, 0, 255);
	red = fs.readFileSync(`${io.dir}/red.jpg`);
	blue = fs.readFileSync(`${io.dir}/blue.jpg`);
});

test('an edited source gets a new id, so a rebuild writes its new pixels under a new name', async () => {
	const before = (await plan_image(`${io.dir}/red.jpg`, SETTINGS)).id;
	const after = (await plan_image(`${io.dir}/blue.jpg`, SETTINGS)).id;
	expect(after).not.toBe(before);
	expect(await red_of(await build_with(before, red))).toBeGreaterThan(200);
	expect(await red_of(await build_with(after, blue))).toBeLessThan(50);
});

test("a page that names a source's old content, asked after its original changed, gets no file: the new pixels are never kept under the old name", async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	await solid(`${io.dir}/green.jpg`, 0, 255, 0);
	const v1 = (await plan_image(`${io.dir}/green.jpg`, SETTINGS)).id;
	fs.writeFileSync(io.original, blue);
	const res = await get(mint({ id: v1, src: SRC, width: 64, height: 64, format: 'webp' }, false)!);
	const built = await build_with(v1, fs.readFileSync(`${io.dir}/green.jpg`));
	const stats = (await sharp(built).stats()).channels;
	expect(stats[2]!.mean).toBeLessThan(50);
	expect(stats[1]!.mean).toBeGreaterThan(200);
	expect(res.status).toBe(404);
	expect(res.headers.get('cache-control')).toBe('no-store');
	expect(String(warn.mock.calls[0]?.[0])).toMatch(/image_source_changed/);
	warn.mockRestore();
});

test('a descriptor naming one source by id and another by file is never answered with the other file', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const victim = (await plan_image(`${io.dir}/red.jpg`, SETTINGS)).id;
	fs.writeFileSync(io.original, blue);
	const res = await get(
		mint({ id: victim, src: SRC, width: 48, height: 48, format: 'webp' }, false)!
	);
	expect(res.status).toBe(404);
	warn.mockRestore();
});
