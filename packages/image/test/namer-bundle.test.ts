// The namer module ships to the browser (an island names files too), so a bundle of it holds the
// link code of the platform the app's encoders name, and no other platform's.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, type Rolldown } from 'vite';
import { expect, test } from 'vitest';
import { cloudflare, namer_module, sharp, vercel, type Encoder } from '../src/vite/encoder.ts';

async function bundle(encoders: readonly Encoder[]): Promise<string> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-namer-'));
	const entry = path.join(dir, 'namer.js');
	fs.writeFileSync(entry, namer_module(encoders, false));
	const out = (await build({
		configFile: false,
		logLevel: 'silent',
		build: {
			write: false,
			minify: false,
			lib: { entry, formats: ['es'], fileName: 'namer' }
		}
	})) as Rolldown.RolldownOutput[];
	return out
		.flatMap((o) => o.output)
		.map((c) => ('code' in c ? c.code : ''))
		.join('\n');
}

test("a cloudflare() app's namer holds Cloudflare's link code and none of Vercel's", async () => {
	const code = await bundle([cloudflare()]);
	expect(code).toContain('/cdn-cgi/image/');
	expect(code).not.toContain('/_vercel/image');
});

test("a vercel() app's namer holds Vercel's link code and none of Cloudflare's", async () => {
	const code = await bundle([vercel(), sharp()]);
	expect(code).toContain('/_vercel/image');
	expect(code).not.toContain('/cdn-cgi/image/');
});
