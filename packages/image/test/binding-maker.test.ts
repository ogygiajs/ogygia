// The Images binding maker on the endpoint (cloudflare() on Workers): each file is made by the
// binding the request's platform carries, in sharp's steps, kept in the Worker's cache and read from
// it next time; a Worker with no such binding answers 500, says image_binding_missing once, and
// keeps nothing.
import fs from 'node:fs';
import { beforeAll, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { id_of, make_images } from './fixtures.ts';

const io = vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	return { file: '', id: '' };
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/a.png': '/_app/immutable/assets/a.Ab12.png' },
	remote: []
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({ read: () => new Response(fs.readFileSync(io.file)) }));
vi.mock('virtual:ogygia-image/maker', async () => {
	const { binding_maker } = await import('../src/makers/binding.ts');
	return binding_maker('IMAGES');
});

class FakeCache {
	kept = new Map<string, Response>();
	async match(key: string): Promise<Response | undefined> {
		return this.kept.get(key)?.clone();
	}
	async put(key: string, res: Response): Promise<void> {
		this.kept.set(key, res);
	}
}
const cache = new FakeCache();
(globalThis as { caches?: unknown }).caches = { default: cache };

const asked: unknown[][] = [];
const IMAGES = {
	input(stream: ReadableStream<Uint8Array>) {
		const steps: unknown[] = [];
		const t = {
			transform(step: unknown) {
				steps.push(step);
				return t;
			},
			async output(o: { format: string; quality?: number }) {
				const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
				asked.push([...steps, o, bytes.byteLength]);
				return { response: () => new Response(`made ${o.format}`) };
			}
		};
		return t;
	}
};

const { STEPS_VERSION } = await import('../src/encoders/cloudflare.ts');
const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

beforeAll(async () => {
	io.file = (await make_images()).small;
	io.id = await id_of(io.file);
});

const url_at = (width: number): string =>
	mint(
		{
			id: io.id,
			src: '/_app/immutable/assets/a.Ab12.png',
			width,
			height: width / 2,
			format: 'webp',
			position: 'top',
			ops: { flop: true }
		},
		false
	)!;

async function get(url: string, platform: unknown): Promise<Response> {
	return (await server.request!(
		ctx(new Request(new URL(url, 'http://localhost')), { platform } as never)
	))!;
}

test('a file is made by the binding in steps, kept in the Worker cache, and read from it the next time', async () => {
	const url = url_at(40);
	const first = await get(url, { env: { IMAGES } });
	expect(first.status).toBe(200);
	expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
	expect(first.headers.get('content-type')).toBe('image/webp');
	expect(await first.text()).toBe('made image/webp');
	expect(asked).toEqual([
		[
			{ flip: 'h' },
			{ width: 40, height: 20, fit: 'cover', gravity: 'top' },
			{ format: 'image/webp', quality: 80 },
			fs.statSync(io.file).size
		]
	]);
	expect([...cache.kept.keys()]).toEqual([
		`https://ogygia-image.invalid/v${STEPS_VERSION}/${io.id}-40x20-ptop-oeyJmbG9wIjp0cnVlfQ.webp`
	]);
	const again = await get(url, { env: {} });
	expect(again.status).toBe(200);
	expect(await again.text()).toBe('made image/webp');
	expect(asked.length).toBe(1);
});

test('a Worker with no such binding answers 500 kept nowhere, says image_binding_missing once, and keeps nothing', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const kept = cache.kept.size;
	for (const width of [60, 80]) {
		const res = await get(url_at(width), { env: { ASSETS: {} } });
		expect(res.status).toBe(500);
		expect(res.headers.get('cache-control')).toBe('no-store');
	}
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
		expect.stringMatching(
			/Images binding IMAGES, but this Worker has no such binding.*image_binding_missing/s
		)
	]);
	expect(cache.kept.size).toBe(kept);
	warn.mockRestore();
});

test('a file the binding cannot decode (an Images error about the input) is a broken source; any other binding failure is that one file’s', async () => {
	const { binding_maker } = await import('../src/makers/binding.ts');
	const { SourceUnreadable } = await import('../src/maker.ts');
	const failing = (error: Error) => ({
		env: {
			IMAGES: {
				input: () => ({
					transform() {
						return this;
					},
					output: () => Promise.reject(error)
				})
			}
		}
	});
	const recipe = { width: 40, height: 20, format: 'webp' } as never;
	const maker = binding_maker('IMAGES');
	for (const code of [9412, 9413, 9520, 9523]) {
		const error = Object.assign(new Error(`IMAGES_TRANSFORM_ERROR ${code}: bad input`), { code });
		const thrown = await maker.make(new Uint8Array(8), recipe, failing(error)).catch((e) => e);
		expect(thrown, `code ${code}`).toBeInstanceOf(SourceUnreadable);
	}
	for (const error of [
		Object.assign(new Error('IMAGES_TRANSFORM_ERROR 9422: usage limit reached'), { code: 9422 }),
		new Error('Network connection lost.')
	]) {
		const thrown = await maker.make(new Uint8Array(8), recipe, failing(error)).catch((e) => e);
		expect(thrown).toBe(error);
	}
});
