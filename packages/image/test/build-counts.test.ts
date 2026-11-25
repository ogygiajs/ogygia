// The e2e fixture's static build, counted: each file it writes is encoded once into the build
// cache, and a build that keeps the cache encodes nothing and writes the same bytes. Counts, not
// time (bench/build-time.ts times it). The fixture is copied to a folder of its own, its
// node_modules linked entry by entry, so its build cache and output are this test's alone.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { BUILD_ENV } from '../src/handoff.ts';

const FIXTURE = fileURLToPath(new URL('../e2e/app', import.meta.url));
const COPIED: readonly string[] = [
	'src',
	'package.json',
	'svelte.config.js',
	'vite.config.ts',
	'image.config.ts',
	'remote-host.ts',
	'tsconfig.json'
];
const BUILD_MS = 180_000;

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
	app = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-counts-'));
	for (const name of COPIED)
		fs.cpSync(path.join(FIXTURE, name), path.join(app, name), { recursive: true });
	link_modules(path.join(FIXTURE, 'node_modules'), path.join(app, 'node_modules'));
});

afterAll(() => {
	if (app) fs.rmSync(app, { recursive: true, force: true });
});

function build(): void {
	const env: NodeJS.ProcessEnv = { ...process.env, IMAGE_E2E_STATIC: '1' };
	delete env[BUILD_ENV];
	const res = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
		cwd: app,
		env,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024
	});
	if (res.status !== 0)
		throw new Error(`the fixture's build failed:\n${`${res.stdout}${res.stderr}`.slice(-4000)}`);
}

function files_under(dir: string): string[] {
	return fs
		.readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((name) => fs.statSync(path.join(dir, name)).isFile())
		.sort();
}

/** Each file the build cache's store holds, by name: its inode and time, which a file encoded
 *  again (written whole, then moved in) changes. */
function stored(): Map<string, string> {
	const files = path.join(app, 'node_modules', '.ogygia', 'image', 'files');
	const out = new Map<string, string>();
	for (const version of fs.readdirSync(files)) {
		const dir = path.join(files, version);
		for (const name of files_under(dir)) {
			if (path.basename(name).startsWith('.')) continue;
			const stat = fs.statSync(path.join(dir, name));
			out.set(`${version}/${name}`, `${stat.ino}:${stat.mtimeMs}`);
		}
	}
	return out;
}

/** Each image file the build wrote for its pages, by name: a hash of its bytes. */
function written(): Map<string, string> {
	const dir = path.join(app, 'build', 'static', '_app', 'immutable', 'og');
	return new Map(
		files_under(dir).map((name) => [
			name,
			crypto
				.createHash('sha256')
				.update(fs.readFileSync(path.join(dir, name)))
				.digest('hex')
		])
	);
}

let cold_store = new Map<string, string>();
let cold_files = new Map<string, string>();

test(
	'a cold static build encodes each image file it writes once, into the build cache',
	() => {
		build();
		cold_store = stored();
		cold_files = written();
		expect({ encodes: cold_store.size, files: cold_files.size }).toMatchInlineSnapshot(`
			{
			  "encodes": 246,
			  "files": 246,
			}
		`);
	},
	BUILD_MS
);

test(
	'a warm static build encodes nothing and writes the same image files, byte for byte',
	() => {
		expect(cold_files.size).toBeGreaterThan(0);
		build();
		const warm_store = stored();
		const encoded = [...warm_store].filter(([name, at]) => cold_store.get(name) !== at);
		expect({ encodes: encoded.length, files: warm_store.size }).toEqual({
			encodes: 0,
			files: cold_store.size
		});
		expect(written()).toEqual(cold_files);
	},
	BUILD_MS
);
