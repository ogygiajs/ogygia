// The Kit 3 fixture's build (e2e/app-kit3): Kit 3 builds every leg and prerenders inside its own
// `buildApp`, then hands the output to the adapter in a later one, so the build's end (each file
// the prerendered pages name, and the pages pointed at them) must come between the two. The fixture
// is copied to a folder of its own, its node_modules linked entry by entry, so its build cache and
// output are this test's alone.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { BUILD_ENV } from '../src/handoff.ts';
import { marked_files } from '../e2e/marks.ts';

const FIXTURE = fileURLToPath(new URL('../e2e/app-kit3', import.meta.url));
const COPIED: readonly string[] = ['src', 'package.json', 'vite.config.ts'];
const BUILD_MS = 180_000;
const IMG_SRC_RE = /<img[^>]*\ssrc="([^"]+)"/g;

let app = '';

function link_modules(from: string, to: string): void {
	fs.mkdirSync(to, { recursive: true });
	for (const name of fs.readdirSync(from)) {
		if (name.startsWith('.')) continue;
		const entry = path.join(from, name);
		if (name.startsWith('@')) link_modules(entry, path.join(to, name));
		else fs.symlinkSync(fs.realpathSync(entry), path.join(to, name));
	}
}

beforeAll(() => {
	app = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-kit3-'));
	for (const name of COPIED)
		fs.cpSync(path.join(FIXTURE, name), path.join(app, name), { recursive: true });
	link_modules(path.join(FIXTURE, 'node_modules'), path.join(app, 'node_modules'));
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env[BUILD_ENV];
	const res = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
		cwd: app,
		env,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024
	});
	if (res.status !== 0)
		throw new Error(`the fixture's build failed:\n${`${res.stdout}${res.stderr}`.slice(-4000)}`);
}, BUILD_MS);

afterAll(() => {
	if (app) fs.rmSync(app, { recursive: true, force: true });
});

function image_srcs(page: string): string[] {
	const html = fs.readFileSync(path.join(app, 'build', page), 'utf8');
	return [...html.matchAll(IMG_SRC_RE)].map((m) => m[1]!);
}

test("on Kit 3, no prerendered page keeps the build's mark, in Kit's output or the adapter's", () => {
	const found = marked_files(app, ['.svelte-kit/output/prerendered', 'build']);
	expect(found.read).toBeGreaterThan(0);
	expect(found.marked).toEqual([]);
});

test('on Kit 3, the build writes every image file a prerendered page names, under its own path', () => {
	const srcs = ['index.html', 'about.html'].flatMap(image_srcs);
	expect(srcs.length).toBeGreaterThan(0);
	for (const src of srcs) {
		expect(src).toMatch(/^\/_app\/immutable\/og\//);
		expect(fs.existsSync(path.join(app, 'build', ...src.split('/')))).toBe(true);
	}
});
