// The Kit 3 fixture under `vite build --watch`, with a prerendered page that shows a remote image
// from a host this test serves. A remote image's files are named by the bytes the build fetched, and
// a rebuild prerenders after its end, so it must still find the files the last build named that way.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { dedent } from '@ogygia/core/contract';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { marked_files } from '../e2e/marks.ts';
import { image_srcs, kit3_app, Kit3Watch } from './kit3-app.ts';

const BUILD_MS = 240_000;
const EDITED = '<h1>a CMS page, edited</h1>';
const REFUSED = 'image_watch_rebuild';

let app = '';
let watch: Kit3Watch | null = null;
let host: http.Server | null = null;

function serve(photo: Buffer): Promise<string> {
	const server = http.createServer((_, res) => {
		res.writeHead(200, { 'content-type': 'image/jpeg' });
		res.end(photo);
	});
	host = server;
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () =>
			resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
		)
	);
}

function with_remote_page(origin: string): void {
	const config = path.join(app, 'vite.config.ts');
	fs.writeFileSync(
		config,
		fs
			.readFileSync(config, 'utf8')
			.replace(
				'image({ presets: {',
				`image({ remote: { hosts: [${JSON.stringify(origin)}] }, presets: {`
			)
	);
	const route = path.join(app, 'src/routes/cms');
	fs.mkdirSync(route, { recursive: true });
	const cover = JSON.stringify(`${origin}/cover.jpg`);
	fs.writeFileSync(
		path.join(route, '+page.server.ts'),
		dedent`
			import { remoteImage } from '@ogygia/image';

			export const load = () => ({
				cover: remoteImage(${cover}, { width: 1800, height: 1000, alt: 'A cover' })
			});
		`
	);
	fs.writeFileSync(
		path.join(route, '+page.svelte'),
		dedent`
			<script lang="ts">
				import { Img } from '@ogygia/image';

				let { data } = $props();
			</script>

			<h1>a CMS page</h1>
			<Img of={data.cover} width={400} alt={data.cover.alt!} id="cms" />
		`
	);
}

beforeAll(async () => {
	app = kit3_app();
	with_remote_page(await serve(fs.readFileSync(path.join(app, 'src/lib/hero.jpg'))));
	const w = (watch = new Kit3Watch(app));
	await w.until(() => w.adapted() >= 1);
	const page = path.join(app, 'src/routes/cms/+page.svelte');
	fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('<h1>a CMS page</h1>', EDITED));
	await w.until(() => w.adapted() >= 2 || w.log.includes(REFUSED));
}, BUILD_MS);

afterAll(async () => {
	await watch?.stop();
	await new Promise((resolve) => (host ? host.close(resolve) : resolve(undefined)));
	if (app) fs.rmSync(app, { recursive: true, force: true });
});

test("on Kit 3, a watch rebuild of a page with a remote image finds the file the last build named by the image's bytes", () => {
	expect(watch!.log).not.toContain(REFUSED);
	expect(fs.readFileSync(path.join(app, 'build/cms.html'), 'utf8')).toContain(EDITED);
	const srcs = image_srcs(app, 'cms.html');
	expect(srcs.length).toBeGreaterThan(0);
	for (const src of srcs) {
		expect(src).toMatch(/^\/_app\/immutable\/og\//);
		expect(fs.existsSync(path.join(app, 'build', ...src.split('/')))).toBe(true);
	}
	expect(marked_files(app, ['.svelte-kit/output/prerendered', 'build']).marked).toEqual([]);
});
