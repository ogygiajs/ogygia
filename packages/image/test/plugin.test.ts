// The plugin's load hook: which originals the server may read, and the paths it hands `<Img>`.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { beforeAll, expect, test, vi } from 'vitest';
import { cloudflare, image, sharp, vercel, type ImagePluginOptions } from '../src/vite/index.ts';
import { remote_name, remote_src } from '../src/vite/remote.ts';
import { image_specifier } from '../src/vite/macro.ts';
import { source_id } from '../src/source-id.ts';
import { app_with_sharp, make_images } from './fixtures.ts';

let root: string;
beforeAll(async () => {
	const img = await make_images();
	root = app_with_sharp(fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-plugin-')));
	for (const rel of ['src/lib/server/secret.jpg', 'src/lib/a.jpg', 'src/lib/__tests__/t.jpg']) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.copyFileSync(img.jpg, path.join(root, rel));
	}
});

async function loader(
	define: Record<string, string> = { __SVELTEKIT_APP_DIR__: '"_app"' },
	options: ImagePluginOptions = {},
	command: 'serve' | 'build' = 'serve'
): Promise<Plugin> {
	const plugin = image(options).find((p) => p.name === '@ogygia/image:load')!;
	await (plugin.configResolved as (c: unknown) => unknown)({
		root,
		command,
		build: { outDir: path.join(root, '.svelte-kit/output/client') },
		define
	} as unknown as ResolvedConfig);
	return plugin;
}

function load(plugin: Plugin, id: string): Promise<unknown> {
	const ctx = { addWatchFile: () => {} };
	return Promise.resolve((plugin.load as (this: unknown, id: string) => unknown).call(ctx, id));
}

function resolve(plugin: Plugin, id: string, importer?: string): Promise<string> {
	return Promise.resolve(
		(plugin.resolveId as (id: string, importer?: string) => string | Promise<string>)(id, importer)
	);
}

test('the server reads no original under src/lib/server or in a test folder, and the macro says so', async () => {
	const plugin = await loader();
	const sources = String(await load(plugin, '\0virtual:ogygia-image/sources'));
	expect(sources).toContain('"!/src/lib/server/**"');
	expect(sources).toContain('"!/src/**/__tests__/**"');
	for (const rel of ['src/lib/server/secret.jpg', 'src/lib/__tests__/t.jpg'])
		await expect(load(plugin, `${path.join(root, rel)}?og-image`)).rejects.toThrow(
			/outside src\/lib\/server\/ and test files/
		);
	expect(String(await load(plugin, `${path.join(root, 'src/lib/a.jpg')}?og-image`))).toMatch(
		/^import __src from/
	);
});

test("<Img> is handed Kit's base, assets and app folder, read from Kit's own plugin", async () => {
	const config = String(
		await load(
			await loader({
				__SVELTEKIT_APP_DIR__: '"_shop"',
				__SVELTEKIT_PATHS_BASE__: '"/shop"',
				__SVELTEKIT_PATHS_ASSETS__: '""'
			}),
			'\0virtual:ogygia-image/config'
		)
	);
	expect(config).toContain('"paths":{"base":"/shop","assets":"","app_dir":"_shop"}');
});

test('without SvelteKit there are no paths to name files by: a coded error, not a silent default', async () => {
	await expect(load(await loader({}), '\0virtual:ogygia-image/config')).rejects.toThrow(
		/found no SvelteKit config/
	);
});

test('the endpoint makes files with the maker the encoder names, sharp by default, and no encoder links files', async () => {
	for (const options of [{}, { encoder: sharp() }, { encoder: [sharp()] }]) {
		const plugin = await loader(undefined, options);
		expect(String(await load(plugin, '\0virtual:ogygia-image/maker'))).toMatch(
			/^export \* from ".*\/src\/makers\/sharp\.ts";\n$/
		);
		expect(String(await load(plugin, '\0virtual:ogygia-image/namer'))).toMatch(
			/^export \* from ".*\/src\/namers\/endpoint\.ts";\n$/
		);
	}
});

test('cloudflare() makes files with its Images binding in a build and with sharp in dev, and names live files by its links in a build only', async () => {
	const define = { __SVELTEKIT_APP_DIR__: '"_app"' };
	const built = await loader(define, { encoder: cloudflare({ binding: 'PICS' }) }, 'build');
	const maker = String(await load(built, '\0virtual:ogygia-image/maker'));
	expect(maker).toMatch(/import \{ binding_maker \} from ".*\/src\/makers\/binding\.ts";/);
	expect(maker).toContain('binding_maker("PICS")');
	const namer = String(await load(built, '\0virtual:ogygia-image/namer'));
	expect(namer).toMatch(/import \{ namer \} from ".*\/src\/namers\/resolve\.ts";/);
	expect(namer).toContain('"links":[{"kind":"cloudflare"');
	expect(namer).toContain('"dev":false');
	const dev = await loader(define, { encoder: cloudflare() });
	expect(String(await load(dev, '\0virtual:ogygia-image/maker'))).toMatch(
		/^export \* from ".*\/src\/makers\/sharp\.ts";\n$/
	);
	expect(String(await load(dev, '\0virtual:ogygia-image/namer'))).toContain('"dev":true');
	const unlinked = await loader(define, { encoder: cloudflare({ links: false }) }, 'build');
	expect(String(await load(unlinked, '\0virtual:ogygia-image/namer'))).toContain('"links":[]');
});

test("with vercel(), a source's own quality that vercel({ qualities }) does not list fails the build where the source is read, not each live render", async () => {
	const define = { __SVELTEKIT_APP_DIR__: '"_app"' };
	const plugin = await loader(define, { encoder: vercel({ qualities: [60, 80] }) }, 'build');
	const file = path.join(root, 'src/lib/a.jpg');
	await expect(load(plugin, `${image_specifier(file, { quality: 70 })}`)).rejects.toMatchObject({
		code: 'image_option_invalid'
	});
	expect(String(await load(plugin, image_specifier(file, { quality: 80 })))).toContain('"id"');
});

test("vercel() alone has no endpoint maker; its sizes bound every file's width; a list keeps sharp's endpoint", async () => {
	const define = { __SVELTEKIT_APP_DIR__: '"_app"' };
	const alone = await loader(define, { encoder: vercel({ sizes: [640, 1280] }) }, 'build');
	expect(String(await load(alone, '\0virtual:ogygia-image/maker'))).toMatch(
		/^export \* from ".*\/src\/makers\/none\.ts";\n$/
	);
	const namer = String(await load(alone, '\0virtual:ogygia-image/namer'));
	expect(namer).toContain('"kind":"vercel"');
	expect(namer).toContain('"sizes":[640,1280],"qualities":[60,80]');
	expect(namer).toContain('"endpoint":null');
	expect(String(await load(alone, '\0virtual:ogygia-image/config'))).toContain(
		'"widths":[640,1280]'
	);
	const listed = await loader(define, { encoder: [vercel(), sharp()] }, 'build');
	expect(String(await load(listed, '\0virtual:ogygia-image/maker'))).toMatch(
		/^export \* from ".*\/src\/makers\/sharp\.ts";\n$/
	);
	expect(String(await load(listed, '\0virtual:ogygia-image/namer'))).toContain('"endpoint":[]');
	const plain = await loader(define, {}, 'build');
	expect(String(await load(plain, '\0virtual:ogygia-image/config'))).not.toContain('widths');
});

async function server_build(options: ImagePluginOptions, adapter: string): Promise<unknown> {
	const plugin = image(options).find((p) => p.name === '@ogygia/image:load')!;
	const outDir = path.join(root, '.svelte-kit/output/server');
	await (plugin.configResolved as (c: unknown) => unknown)({
		root,
		command: 'build',
		build: { outDir },
		define: {
			__SVELTEKIT_APP_DIR__: '"_app"',
			__SVELTEKIT_ADAPTER_NAME__: JSON.stringify(adapter)
		}
	} as unknown as ResolvedConfig);
	return (plugin.buildStart as (this: unknown) => unknown).call({
		environment: { name: 'ssr', config: { build: { outDir } } }
	});
}

test("a platform's encoder on another adapter fails the server build, as its links and maker exist only on that platform", async () => {
	await expect(
		server_build({ encoder: cloudflare() }, '@sveltejs/adapter-cloudflare')
	).resolves.not.toThrow();
	await expect(
		server_build({ encoder: [vercel(), sharp()] }, '@sveltejs/adapter-vercel')
	).resolves.not.toThrow();
	for (const encoder of [cloudflare(), cloudflare({ links: false })])
		await expect(server_build({ encoder }, '@sveltejs/adapter-node')).rejects.toThrow(
			/'encoder' must be cloudflare\(\) on @sveltejs\/adapter-cloudflare: its links and Images binding exist only on Cloudflare \(this app's adapter is @sveltejs\/adapter-node\)[\s\S]*\/e\/image_option_invalid/
		);
	await expect(server_build({ encoder: vercel() }, '@sveltejs/adapter-node')).rejects.toThrow(
		/lacks adapter-vercel \(this app's adapter is @sveltejs\/adapter-node\)[\s\S]*\/e\/image_vercel_config/
	);
});

test('on adapter-auto, the message says to list the platform adapter itself: auto cannot hand it the encoder config', async () => {
	await expect(server_build({ encoder: cloudflare() }, '@sveltejs/adapter-auto')).rejects.toThrow(
		/this app's adapter is @sveltejs\/adapter-auto, which picks a platform but cannot be handed its config: install and list @sveltejs\/adapter-cloudflare itself/
	);
	await expect(server_build({ encoder: vercel() }, '@sveltejs/adapter-auto')).rejects.toThrow(
		/install and list @sveltejs\/adapter-vercel itself/
	);
});

test("only an app that lists vercel() gets the output check, run after the server build's other closeBundle hooks", () => {
	expect(image({}).map((p) => p.name)).not.toContain('@ogygia/image:vercel-config');
	const check = image({ encoder: [vercel(), sharp()] }).find(
		(p) => p.name === '@ogygia/image:vercel-config'
	)!;
	expect(check.apply).toBe('build');
	expect(check.closeBundle).toMatchObject({ order: 'post', sequential: true });
});

test('vercel() alone offers no still of a moving image, and its server build says so once; a list with sharp() does', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		await server_build({ encoder: vercel() }, '@sveltejs/adapter-vercel');
		expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/image_still_left_out/);
		const define = { __SVELTEKIT_APP_DIR__: '"_app"' };
		const alone = await loader(define, { encoder: vercel() }, 'build');
		expect(String(await load(alone, '\0virtual:ogygia-image/config'))).toContain('"stills":false');
		const dev = await loader(define, { encoder: vercel() });
		expect(String(await load(dev, '\0virtual:ogygia-image/config'))).not.toContain('stills');
		const listed = await loader(define, { encoder: [vercel(), sharp()] }, 'build');
		expect(String(await load(listed, '\0virtual:ogygia-image/config'))).not.toContain('stills');
	} finally {
		warn.mockRestore();
	}
});

test('the theme stylesheet resolves to a file path, with and without a query', async () => {
	const plugin = await loader(undefined, {
		theme: { dark: '.dark', light: '.light' }
	});
	const file = await resolve(plugin, 'virtual:ogygia-image/theme.css');
	expect(file).toMatch(/^\/.*\/src\/og-theme\.css$/);
	expect(await resolve(plugin, 'virtual:ogygia-image/theme.css?inline')).toBe(`${file}?inline`);
	expect(await resolve(plugin, `/@fs${file}?inline`)).toBe(`${file}?inline`);
	expect(String(await load(plugin, `${file}?inline`))).toContain(':is(.dark)');
	const plain = await loader();
	expect(String(await load(plain, file))).toBe('');
	expect(String(await load(plugin, '\0virtual:ogygia-image/config'))).toContain('"themed":true');
});

test('a remote image resolves to its file in the build cache, loads as a source, and the server build lists it for the endpoint', async () => {
	const img = await make_images();
	const bytes = fs.readFileSync(img.jpg);
	const host = http.createServer((_, res) => {
		res.writeHead(200, { 'content-type': 'image/jpeg' });
		res.end(bytes);
	});
	await new Promise<void>((done) => host.listen(0, '127.0.0.1', done));
	try {
		const origin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
		const url = `${origin}/a/hero.jpg`;
		const define = { __SVELTEKIT_APP_DIR__: '"_app"' };
		const plugin = image({ remote: { hosts: [origin] } }).find(
			(p) => p.name === '@ogygia/image:load'
		)!;
		await (plugin.configResolved as (c: unknown) => unknown)({
			root,
			command: 'build',
			build: { ssr: true, outDir: path.join(root, '.svelte-kit/output/server') },
			define: { ...define, __SVELTEKIT_ADAPTER_NAME__: '"@sveltejs/adapter-node"' }
		});
		const file = await resolve(
			plugin,
			`${remote_src(url)}?og-image`,
			path.join(root, 'src/routes/+page.svelte')
		);
		expect(file).toMatch(new RegExp(`/remote/${remote_name(url)}\\.jpg\\?og-image$`));
		expect(fs.readFileSync(file.split('?')[0]!).equals(bytes)).toBe(true);
		const module = String(await load(plugin, file));
		expect(module).toContain(
			`import __src from ${JSON.stringify(`${file.split('?')[0]}?no-inline`)}`
		);
		expect(module).toContain(`"id":${JSON.stringify(await source_id(bytes))}`);

		const sources = String(await load(plugin, '\0virtual:ogygia-image/sources'));
		const render = plugin.renderChunk as (code: string) => { code: string } | null;
		const chunk = render.call({}, sources)!;
		expect(chunk.code).toContain(`export const remote = ["${remote_name(url)}"];`);

		const unlisted = await loader(define, {}, 'build');
		await expect(
			resolve(unlisted, `${remote_src(url)}?og-image`, path.join(root, 'src/a.ts'))
		).rejects.toThrow(
			/src\/a\.ts: '.*' is on a host image\(\{ remote: \{ hosts \} \}\) does not list/
		);
	} finally {
		host.close();
	}
});
