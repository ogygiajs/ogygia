// The Kit 3 fixture's build (e2e/app-kit3): Kit 3 builds every leg and prerenders inside its own
// `buildApp`, then hands the output to the adapter in a later one, so the build's end (each file
// the prerendered pages name, and the pages pointed at them) must come between the two.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { marked_files } from '../e2e/marks.ts';
import { build_env, image_srcs, kit3_app } from './kit3-app.ts';

const BUILD_MS = 180_000;

let app = '';

beforeAll(() => {
	app = kit3_app();
	const res = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
		cwd: app,
		env: build_env(),
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024
	});
	if (res.status !== 0)
		throw new Error(`the fixture's build failed:\n${`${res.stdout}${res.stderr}`.slice(-4000)}`);
}, BUILD_MS);

afterAll(() => {
	if (app) fs.rmSync(app, { recursive: true, force: true });
});

test("on Kit 3, no prerendered page keeps the build's mark, in Kit's output or the adapter's", () => {
	const found = marked_files(app, ['.svelte-kit/output/prerendered', 'build']);
	expect(found.read).toBeGreaterThan(0);
	expect(found.marked).toEqual([]);
});

test('on Kit 3, the build writes every image file a prerendered page names, under its own path', () => {
	const srcs = ['index.html', 'about.html'].flatMap((page) => image_srcs(app, page));
	expect(srcs.length).toBeGreaterThan(0);
	for (const src of srcs) {
		expect(src).toMatch(/^\/_app\/immutable\/og\//);
		expect(fs.existsSync(path.join(app, 'build', ...src.split('/')))).toBe(true);
	}
});
