// sharp is a peer the app installs: a build or dev server that cannot reach it from the app, or whose
// server output would bundle it, fails with a coded error before any image is made.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { expect, test, vi } from 'vitest';
import { check, dead_fields } from '@ogygia/machine/testing';
import { IMAGE_WARNINGS } from '../src/messages.ts';
import { ENCODER } from '../src/vite/encoder.ts';
import { cloudflare, image, sharp, type ImagePluginOptions } from '../src/vite/index.ts';

const PNP = vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	return { prefix: 'og-image-pnp-', entry: '' };
});

vi.mock('node:module', async (original) => {
	const real = await original<{ createRequire: (from: string | URL) => NodeJS.Require }>();
	const createRequire = (from: string | URL): NodeJS.Require => {
		const req = real.createRequire(from);
		if (!String(from).includes(PNP.prefix)) return req;
		const resolve = ((id: string) => {
			if (id === 'sharp') return PNP.entry;
			return req.resolve(id);
		}) as NodeJS.RequireResolve;
		return Object.assign(((id: string) => req(id)) as NodeJS.Require, req, { resolve });
	};
	return { ...real, default: { ...real, createRequire }, createRequire };
});

const SHARP_ENTRY = createRequire(import.meta.url).resolve('sharp');
const SHARP_DIR = path.dirname(path.dirname(SHARP_ENTRY));
PNP.entry = SHARP_ENTRY;
const NODE = '"@sveltejs/adapter-node"';
const STATIC = '"@sveltejs/adapter-static"';
const EDGE = '"@sveltejs/adapter-cloudflare"';

/** An app folder: its package.json lists sharp under `listed` (or nowhere), and `installed` links
 *  sharp into its node_modules. */
function app(listed: 'dependencies' | 'devDependencies' | null, installed: boolean): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-sharp-'));
	const pkg: Record<string, unknown> = { name: 'app', private: true, type: 'module' };
	if (listed) pkg[listed] = { sharp: '^0.35.0' };
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
	if (installed) {
		fs.mkdirSync(path.join(root, 'node_modules'));
		fs.symlinkSync(SHARP_DIR, path.join(root, 'node_modules', 'sharp'), 'dir');
	}
	return root;
}

async function resolved(
	root: string,
	adapter: string | null,
	command = 'build',
	options: ImagePluginOptions = {}
): Promise<void> {
	const plugin = image(options).find((p) => p.name === '@ogygia/image:load') as Plugin;
	const define: Record<string, string> = { __SVELTEKIT_APP_DIR__: '"_app"' };
	if (adapter) define.__SVELTEKIT_ADAPTER_NAME__ = adapter;
	await (plugin.configResolved as (c: unknown) => unknown)({
		root,
		command,
		build: { ssr: command === 'build', outDir: path.join(root, '.svelte-kit/output/server') },
		define
	} as unknown as ResolvedConfig);
}

test('a node server build fails, coded, when the app does not install sharp itself', async () => {
	await expect(resolved(app(null, false), NODE)).rejects.toThrow(/image_sharp_missing/);
});

test("a node server build fails, coded, when sharp is installed but not in the app's dependencies, so the adapter would bundle it", async () => {
	await expect(resolved(app('devDependencies', true), NODE)).rejects.toThrow(
		/image_sharp_missing.*dependencies|dependencies[\s\S]*image_sharp_missing/
	);
	await expect(resolved(app(null, true), NODE)).rejects.toThrow(/image_sharp_missing/);
});

test("a node server build with sharp in the app's dependencies goes on", async () => {
	await expect(resolved(app('dependencies', true), NODE)).resolves.toBeUndefined();
});

test('a build with no node_modules folder (Yarn PnP) goes on when Node resolves sharp from the app', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), PNP.prefix));
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({ name: 'app', private: true, dependencies: { sharp: '^0.35.0' } })
	);
	const node_path = process.env.NODE_PATH;
	delete process.env.NODE_PATH;
	try {
		await expect(resolved(root, NODE)).resolves.toBeUndefined();
		await expect(resolved(root, null, 'serve')).resolves.toBeUndefined();
	} finally {
		if (node_path !== undefined) process.env.NODE_PATH = node_path;
	}
});

test('with NODE_PATH set, a sharp that Node finds with no node_modules folder at or above the app is not the app installing it', async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), PNP.prefix));
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify({ name: 'app', private: true, dependencies: { sharp: '^0.35.0' } })
	);
	const node_path = process.env.NODE_PATH;
	process.env.NODE_PATH = path.dirname(SHARP_DIR);
	try {
		await expect(resolved(root, NODE)).rejects.toThrow(/image_sharp_missing/);
	} finally {
		if (node_path === undefined) delete process.env.NODE_PATH;
		else process.env.NODE_PATH = node_path;
	}
});

test('a static build, which runs no server, needs sharp installed and listed, devDependencies is enough', async () => {
	await expect(resolved(app('devDependencies', true), STATIC)).resolves.toBeUndefined();
	await expect(resolved(app(null, false), STATIC)).rejects.toThrow(/image_sharp_missing/);
});

test('the dev server fails, coded, when the app does not install sharp', async () => {
	await expect(resolved(app(null, false), null, 'serve')).rejects.toThrow(/image_sharp_missing/);
	await expect(resolved(app('devDependencies', true), null, 'serve')).resolves.toBeUndefined();
});

test('a Cloudflare build that lists no encoder fails, coded, naming cloudflare() and sharp() for prerendered images only', async () => {
	for (const adapter of [EDGE, '"@sveltejs/adapter-cloudflare-workers"'])
		await expect(resolved(app('devDependencies', true), adapter)).rejects.toMatchObject({
			code: 'image_option_invalid',
			message: expect.stringMatching(/cloudflare\(\)[\s\S]*sharp\(\)/)
		});
});

test('any other edge build that lists no encoder fails too, coded, naming sharp() for prerendered images only; with sharp() it warns', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		for (const adapter of ['"svelte-adapter-deno"', '"@example/adapter-edge"']) {
			const error = await resolved(app('devDependencies', true), adapter).catch((e: unknown) => e);
			expect(error, adapter).toMatchObject({
				code: 'image_option_invalid',
				message: expect.stringMatching(/sharp\(\)/)
			});
			expect((error as Error).message, adapter).not.toMatch(/list cloudflare\(\)/);
			await expect(
				resolved(app('devDependencies', true), adapter, 'build', { encoder: sharp() })
			).resolves.toBeUndefined();
		}
		expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/image_no_encoder/);
	} finally {
		warn.mockRestore();
	}
});

test('a Cloudflare Workers adapter is Cloudflare for cloudflare() too', async () => {
	await expect(
		resolved(app('devDependencies', true), '"@sveltejs/adapter-cloudflare-workers"', 'build', {
			encoder: cloudflare()
		})
	).resolves.toBeUndefined();
});

test('an edge build with sharp() listed says once that its server cannot encode and names cloudflare(), and needs sharp only to build', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const chosen = { encoder: sharp() };
	await expect(
		resolved(app('devDependencies', true), EDGE, 'build', chosen)
	).resolves.toBeUndefined();
	await expect(
		resolved(app('devDependencies', true), EDGE, 'build', chosen)
	).resolves.toBeUndefined();
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
		expect.stringMatching(
			/adapter-cloudflare runs the app where sharp, a native Node module, cannot load.*image_no_encoder/s
		)
	]);
	expect(IMAGE_WARNINGS.image_no_encoder.details()).toContain('encoder: cloudflare()');
	warn.mockRestore();
	await expect(resolved(app(null, false), EDGE, 'build', chosen)).rejects.toThrow(
		/image_sharp_missing/
	);
});

test('an edge build with cloudflare() says nothing, and needs sharp only to build, devDependencies being enough', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const encoder = { encoder: cloudflare() };
	await expect(
		resolved(app('devDependencies', true), EDGE, 'build', encoder)
	).resolves.toBeUndefined();
	expect(warn).not.toHaveBeenCalled();
	warn.mockRestore();
	await expect(resolved(app(null, false), EDGE, 'build', encoder)).rejects.toThrow(
		/image_sharp_missing/
	);
});

test('every row of the encoder table: nothing goes on without sharp listed and installed, and no server without it in dependencies', () => {
	check(ENCODER, {
		'no sharp installed fails': (r) => !('plan' in r) || r.input.installed || r.plan === 'missing',
		'not listed fails': (r) => !('plan' in r) || r.input.listed !== 'none' || r.plan === 'missing',
		'a server whose maker is sharp goes on only with sharp in dependencies': (r) =>
			!('plan' in r) ||
			r.input.maker !== 'sharp' ||
			r.input.runtime !== 'server' ||
			r.plan !== 'ok' ||
			r.input.listed === 'dependencies',
		'an edge build whose maker is sharp warns': (r) =>
			!('plan' in r) || r.input.maker !== 'sharp' || r.input.runtime !== 'edge' || r.plan !== 'ok',
		'an edge build is asked to choose its encoder exactly when it chose none and sharp is there': (
			r
		) =>
			!('plan' in r) ||
			(r.plan === 'choose') ===
				(r.input.runtime === 'edge' &&
					r.input.maker === 'sharp' &&
					!r.input.chosen &&
					r.input.installed &&
					r.input.listed !== 'none'),
		'with no maker or the binding, sharp is needed only to build': (r) =>
			!('plan' in r) ||
			r.input.maker === 'sharp' ||
			r.plan === (r.input.installed && r.input.listed !== 'none' ? 'ok' : 'missing')
	});
	expect(dead_fields(ENCODER)).toEqual([]);
});
