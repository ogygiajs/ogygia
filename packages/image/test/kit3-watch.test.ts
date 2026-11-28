// The Kit 3 fixture under `vite build --watch`: Kit's first build runs the app build hooks, but a
// rebuild runs none of them. It builds the legs, prerenders and runs the adapter straight from its
// watcher, so the build's end must hold for a rebuild too.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { marked_files } from '../e2e/marks.ts';
import { build_env, image_srcs, kit3_app } from './kit3-app.ts';

const BUILD_MS = 240_000;
const ADAPTED = '✔ done';
const EDITED = '<h1>images, edited</h1>';

let app = '';
let watch: ChildProcess | null = null;
let log = '';

function adapted(times: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const seen = (): void => {
			if (log.split(ADAPTED).length - 1 >= times) {
				watch?.stdout?.off('data', seen);
				resolve();
			}
		};
		watch?.once('exit', () => reject(new Error(`the watch build stopped:\n${log.slice(-4000)}`)));
		watch?.stdout?.on('data', seen);
		seen();
	});
}

beforeAll(async () => {
	app = kit3_app();
	watch = spawn('node', ['node_modules/vite/bin/vite.js', 'build', '--watch'], {
		cwd: app,
		env: build_env()
	});
	watch.stdout?.on('data', (d: Buffer) => (log += d.toString()));
	watch.stderr?.on('data', (d: Buffer) => (log += d.toString()));
	await adapted(1);
	const page = path.join(app, 'src/routes/+page.svelte');
	fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('<h1>images</h1>', EDITED));
	await adapted(2);
}, BUILD_MS);

afterAll(() => {
	watch?.kill();
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
