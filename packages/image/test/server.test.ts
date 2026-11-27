// The image server realm, started the way the handle starts it (core's plugin test kit: the app's
// real signer, its own key): the minter's URLs, and the endpoint that answers them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { id_of, make_images } from './fixtures.ts';

const files = vi.hoisted(() => new Map<string, string>());
const store = vi.hoisted(() => {
	const dir = `${process.env.TMPDIR ?? '/tmp'}/og-image-server-test-${process.pid}-${Date.now()}`;
	process.env.__OGYGIA_IMAGE_BUILD = JSON.stringify({ store: dir, minted: `${dir}.minted` });
	return dir;
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: {
		'/src/lib/harbor dusk.jpg': '/_app/immutable/assets/harbor%20dusk.Ab12.jpg',
		'/src/lib/spin.gif': '/_app/immutable/assets/spin.Cd34.gif',
		'/src/lib/broken.jpg': '/_app/immutable/assets/broken.Ef56.jpg'
	},
	remote: ['0123456789abcdef0123456789abcdef']
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: false }));
vi.mock('$app/server', () => ({
	read: (asset: string) => {
		const file = files.get(asset);
		if (!file) throw new Error(`Asset does not exist: ${asset}`);
		return new Response(fs.readFileSync(file));
	}
}));

const { default: server } = await import('../src/server.ts');
const { mint, set_minter } = await import('../src/recipe.ts');

set_minter(null);
const { app, ctx } = startPlugin(server, { name: '@ogygia/image' });

async function get(url: string): Promise<Response | undefined> {
	return (await server.request!(ctx(new Request(new URL(url, 'http://localhost'))))) ?? undefined;
}

const HARBOR = { id: 'h1', src: '/_app/immutable/assets/harbor%20dusk.Ab12.jpg' };
const ids = { harbor: '', spin: '', broken: '' };
const SIG_RE = /\/__ogygia__\/i\/([^/]+)\//;

beforeAll(async () => {
	const img = await make_images();
	files.set('/_app/immutable/assets/harbor%20dusk.Ab12.jpg', img.jpg);
	files.set('/_app/immutable/assets/spin.Cd34.gif', img.gif);
	const broken = `${img.dir}/broken.jpg`;
	fs.writeFileSync(broken, 'not a jpeg');
	files.set('/_app/immutable/assets/broken.Ef56.jpg', broken);
	Object.assign(ids, {
		harbor: await id_of(img.jpg),
		spin: await id_of(img.gif),
		broken: await id_of(broken)
	});
});

describe('the image server realm', () => {
	test('a minted URL is a path under /__ogygia__/i/, signed by the app, the same on every render', () => {
		const a = mint({ ...HARBOR, width: 320, height: 213, format: 'avif' }, false)!;
		expect(a).toMatch(
			/^\/__ogygia__\/i\/[\w-]+\/h1-320x213\/_app\/immutable\/assets\/harbor%20dusk\.Ab12\.jpg\.avif$/
		);
		const sig = SIG_RE.exec(a)![1]!;
		expect(app.verify(`image|${a.slice(a.indexOf(sig) + sig.length + 1)}`, sig)).toBe(true);
		expect(mint({ ...HARBOR, width: 320, height: 213, format: 'avif' }, false)).toBe(a);
	});

	test('a recipe rendered again reuses its signed URL: one signature per recipe, not per render', () => {
		const sign = vi.spyOn(app, 'sign');
		const recipe = { ...HARBOR, width: 333, height: 222, format: 'webp' as const };
		const urls = [mint(recipe, false), mint(recipe, false), mint({ ...recipe }, false)];
		expect(new Set(urls).size).toBe(1);
		expect(sign).toHaveBeenCalledTimes(1);
		sign.mockRestore();
	});

	test("a warmed preset's recipe names the file the build made, signing nothing", () => {
		const sign = vi.spyOn(app, 'sign');
		expect(mint({ ...HARBOR, width: 48, height: 48, format: 'webp' }, true)).toBe(
			'/_app/immutable/og/h1-48x48.webp'
		);
		expect(sign).not.toHaveBeenCalled();
		sign.mockRestore();
	});

	test('the endpoint makes the file the URL describes, kept forever', async () => {
		const url = mint(
			{ ...HARBOR, id: ids.harbor, width: 320, height: 320, format: 'webp', position: 'top' },
			false
		)!;
		const res = (await get(url))!;
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['webp', 320, 320]);
	});

	test('the second ask is read from the store, whole, with its length', async () => {
		const url = mint(
			{ ...HARBOR, id: ids.harbor, width: 200, height: 133, format: 'avif' },
			false
		)!;
		const first = Buffer.from(await (await get(url))!.arrayBuffer());
		expect(fs.readdirSync(store).length).toBeGreaterThan(0);
		const again = (await get(url))!;
		expect(again.headers.get('content-length')).toBe(String(first.byteLength));
		expect(Buffer.from(await again.arrayBuffer()).equals(first)).toBe(true);
	});

	test('an animated source stays animated', async () => {
		const url = mint(
			{
				id: ids.spin,
				src: '/_app/immutable/assets/spin.Cd34.gif',
				width: 160,
				height: 120,
				format: 'webp'
			},
			false
		)!;
		const res = (await get(url))!;
		const meta = await sharp(Buffer.from(await res.arrayBuffer()), { animated: true }).metadata();
		expect(meta.pages).toBe(3);
	});

	test('a URL whose recipe was changed after signing is refused, naming why and the key', async () => {
		const url = mint({ ...HARBOR, width: 48, height: 48, format: 'webp' }, false)!;
		const res = (await get(url.replace('-48x48/', '-4000x4000/')))!;
		expect(res.status).toBe(403);
		expect(res.headers.get('x-ogygia-deny')).toBe('sig');
		expect(res.headers.get('x-ogygia-key')).toBe(app.deny('sig').headers.get('x-ogygia-key'));
		expect(res.headers.get('x-ogygia-key')).toMatch(/^[\w-]{8}$/);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	test('a URL with no signature, or a forged one, is refused', async () => {
		const url = mint({ ...HARBOR, width: 48, height: 48, format: 'webp' }, false)!;
		const sig = SIG_RE.exec(url)![1]!;
		expect((await get(url.replace(`${sig}/`, '')))!.status).toBe(403);
		expect((await get(url.replace(sig, 'A'.repeat(sig.length))))!.status).toBe(403);
	});

	test('a signed recipe naming an original the app does not ship is not found', async () => {
		const url = mint(
			{
				id: 'x',
				src: '/_app/immutable/assets/secret.Zz.jpg',
				width: 48,
				height: 48,
				format: 'webp'
			},
			false
		)!;
		expect((await get(url))!.status).toBe(404);
	});

	test('a remote image the server build fetched is an original the endpoint reads; any other name under the assets is not', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const at = (name: string): string =>
				mint(
					{
						id: ids.harbor,
						src: `/_app/immutable/assets/${name}.Xy12.jpg`,
						width: 48,
						height: 32,
						format: 'webp'
					},
					false
				)!;
			const fetched = (await get(at('0123456789abcdef0123456789abcdef')))!;
			expect(fetched.status).not.toBe(404);
			expect(String(warn.mock.calls[0]?.[0])).toMatch(/Asset does not exist/);
			expect((await get(at('ffffffffffffffffffffffffffffffff')))!.status).toBe(404);
		} finally {
			warn.mockRestore();
		}
	});

	test('a signed path that is not a recipe is not found', async () => {
		const bad = 'h1-48x48/_app/%E0%A4%A.jpg.webp';
		expect((await get(`/__ogygia__/i/${app.sign(`image|${bad}`)}/${bad}`))!.status).toBe(404);
	});

	test('an original that cannot be decoded is a coded 500 no cache keeps, not a hung request', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const url = mint(
			{
				id: ids.broken,
				src: '/_app/immutable/assets/broken.Ef56.jpg',
				width: 48,
				height: 48,
				format: 'webp'
			},
			false
		)!;
		const res = (await get(url))!;
		expect(res.status).toBe(500);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(String(warn.mock.calls[0]?.[0])).toMatch(/image_settle_failed/);
		warn.mockRestore();
	});

	test('a request for any other path passes through', async () => {
		expect(await get('/blog/first-post')).toBeUndefined();
		expect(await get('/__ogygia__')).toBeUndefined();
	});

	test('a signed URL asked with any method but GET or HEAD is answered 405', async () => {
		const url = mint({ ...HARBOR, id: ids.harbor, width: 77, height: 51, format: 'webp' }, false)!;
		for (const method of ['POST', 'PUT', 'DELETE']) {
			const res = (await server.request!(
				ctx(new Request(new URL(url, 'http://localhost'), { method }))
			))!;
			expect(res.status, method).toBe(405);
			expect(res.headers.get('allow')).toBe('GET, HEAD');
		}
		const head = (await server.request!(
			ctx(new Request(new URL(url, 'http://localhost'), { method: 'HEAD' }))
		))!;
		expect(head.status).toBe(200);
	});
});

describe('the store a live server keeps', () => {
	test("is a folder only its user can open; another version's folder goes once unused for a week, and one in use by a server beside it stays", async () => {
		const { runtime_store } = await import('../src/store.ts');
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-store-'));
		const root = path.join(tmp, `ogygia-image-${process.getuid!()}`);
		fs.mkdirSync(path.join(root, 'v0-old'), { recursive: true, mode: 0o700 });
		const long_ago = new Date(Date.now() - 8 * 24 * 3600 * 1000);
		fs.utimesSync(path.join(root, 'v0-old'), long_ago, long_ago);
		const beside = runtime_store('7.0.0', tmp)!;
		const s = runtime_store('8.0.0', tmp)!;
		expect(s.dir.startsWith(root)).toBe(true);
		expect(fs.statSync(root).mode & 0o777).toBe(0o700);
		expect(fs.statSync(s.dir).mode & 0o777).toBe(0o700);
		await expect.poll(() => fs.existsSync(path.join(root, 'v0-old'))).toBe(false);
		expect(fs.existsSync(beside.dir)).toBe(true);
	});

	test('keeps at most its size: the least recently asked files go first, while the server runs', async () => {
		const { FileStore } = await import('../src/store.ts');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-cap-'));
		const s = new FileStore(dir, 1000);
		await s.keep('a', new Uint8Array(400));
		await s.keep('b', new Uint8Array(400));
		expect(await s.find('a')).not.toBeNull();
		await s.keep('c', new Uint8Array(400));
		await expect.poll(() => fs.existsSync(s.file('b'))).toBe(false);
		expect(await s.find('a')).not.toBeNull();
		expect(await s.find('c')).not.toBeNull();
	});

	test('counts the files a past run left against its size', async () => {
		const { FileStore } = await import('../src/store.ts');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-cap-'));
		const past = new FileStore(dir, 10_000);
		await past.keep('old', new Uint8Array(600));
		const s = new FileStore(dir, 1000);
		await s.load();
		await s.keep('new', new Uint8Array(600));
		await expect.poll(() => fs.existsSync(s.file('old'))).toBe(false);
		expect(await s.find('new')).not.toBeNull();
	});

	test('a file made long ago but asked for since is kept at the next start: files age by last use', async () => {
		const { FileStore } = await import('../src/store.ts');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-age-'));
		const s = new FileStore(dir);
		await s.keep('used', new Uint8Array(10));
		await s.keep('unused', new Uint8Array(10));
		const long_ago = new Date(Date.now() - 40 * 24 * 3600 * 1000);
		fs.utimesSync(s.file('used'), long_ago, long_ago);
		fs.utimesSync(s.file('unused'), long_ago, long_ago);
		expect(await s.find('used')).not.toBeNull();
		await expect
			.poll(() => Date.now() - fs.statSync(s.file('used')).mtimeMs < 24 * 3600 * 1000)
			.toBe(true);
		await new FileStore(dir).load();
		expect(fs.existsSync(s.file('used'))).toBe(true);
		expect(fs.existsSync(s.file('unused'))).toBe(false);
	});

	test("every user of one folder in a process shares one store, so its size holds for a dev server's whole run", async () => {
		const { FileStore } = await import('../src/store.ts');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-shared-'));
		await new FileStore(dir, 10_000).keep('old', new Uint8Array(600));
		const s = FileStore.shared(dir, 1000);
		expect(FileStore.shared(dir, 1000)).toBe(s);
		await s.keep('new', new Uint8Array(600));
		await expect.poll(() => fs.existsSync(s.file('old'))).toBe(false);
	});

	test('a folder at that place that others can write to, or a link, keeps nothing, and says so', async () => {
		const { runtime_store } = await import('../src/store.ts');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const open = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-store-'));
		fs.mkdirSync(path.join(open, `ogygia-image-${process.getuid!()}`), { mode: 0o777 });
		fs.chmodSync(path.join(open, `ogygia-image-${process.getuid!()}`), 0o777);
		expect(runtime_store('8.0.0', open)).toBeNull();
		const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-store-'));
		const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-elsewhere-'));
		fs.symlinkSync(elsewhere, path.join(linked, `ogygia-image-${process.getuid!()}`));
		expect(runtime_store('8.0.0', linked)).toBeNull();
		expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
			expect.stringMatching(/image_store_unsafe/),
			expect.stringMatching(/image_store_unsafe/)
		]);
		warn.mockRestore();
	});
});
