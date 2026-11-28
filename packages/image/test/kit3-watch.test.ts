// The Kit 3 fixture under `vite build --watch`: Kit's first build runs the app build hooks, but a
// rebuild runs none of them. It builds the legs, prerenders and runs the adapter straight from its
// watcher, so the build's end must hold for a rebuild too.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { marked_files } from '../e2e/marks.ts';
import { image_srcs, kit3_app, Kit3Watch } from './kit3-app.ts';

const BUILD_MS = 240_000;
const EDITED = '<h1>images, edited</h1>';
const REFUSED = 'image_watch_rebuild';

let app = '';
let watch: Kit3Watch | null = null;

beforeAll(async () => {
	app = kit3_app();
	const w = (watch = new Kit3Watch(app));
	await w.until(() => w.adapted() >= 1);
	const page = path.join(app, 'src/routes/+page.svelte');
	fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('<h1>images</h1>', EDITED));
	await w.until(() => w.adapted() >= 2);
}, BUILD_MS);

afterAll(async () => {
	await watch?.stop();
	if (app) fs.rmSync(app, { recursive: true, force: true });
});

test("on Kit 3, a watch rebuild leaves no prerendered page with the build's mark", () => {
	expect(fs.readFileSync(path.join(app, 'build/index.html'), 'utf8')).toContain(EDITED);
	const found = marked_files(app, ['.svelte-kit/output/prerendered', 'build']);
	expect(found.read).toBeGreaterThan(0);
	expect(found.marked).toEqual([]);
});

test('on Kit 3, a watch rebuild writes every image file its prerendered pages name', () => {
	const srcs = ['index.html', 'about.html'].flatMap((page) => image_srcs(app, page));
	expect(srcs.length).toBeGreaterThan(0);
	for (const src of srcs) {
		expect(src).toMatch(/^\/_app\/immutable\/og\//);
		expect(fs.existsSync(path.join(app, 'build', ...src.split('/')))).toBe(true);
	}
});

test(
	'on Kit 3, a watch rebuild whose page names an image file no build made stops before the adapter, out loud',
	async () => {
		const w = watch!;
		const before = fs.readFileSync(path.join(app, 'build/about.html'), 'utf8');
		const page = path.join(app, 'src/routes/about/+page.svelte');
		fs.writeFileSync(
			page,
			fs.readFileSync(page, 'utf8').replace('preset="thumb"', 'preset="thumb" width={123}')
		);
		await w.until(() => w.log.includes(REFUSED));
		expect(fs.readFileSync(path.join(app, 'build/about.html'), 'utf8')).toBe(before);
		expect(marked_files(app, ['.svelte-kit/output/prerendered', 'build']).marked).toEqual([]);
	},
	BUILD_MS
);
