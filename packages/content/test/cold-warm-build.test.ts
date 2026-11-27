// The e2e fixture's real build, twice in one folder: a cold build (no build cache), then a warm one
// that keeps node_modules/.ogygia and .svelte-kit. The fixture is copied to a folder of its own, its
// node_modules linked entry by entry, so its build cache and output are this test's alone.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';

const FIXTURE = fileURLToPath(new URL('../e2e/app', import.meta.url));
const COPIED: readonly string[] = [
	'src',
	'package.json',
	'svelte.config.js',
	'vite.config.ts',
	'tsconfig.json'
];
const BUILD_MS = 180_000;
const SECRET = 'cold-warm-build-secret-0123456789abcdef';

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
	app = fs.mkdtempSync(path.join(os.tmpdir(), 'og-content-cold-warm-'));
	for (const name of COPIED)
		fs.cpSync(path.join(FIXTURE, name), path.join(app, name), { recursive: true });
	link_modules(path.join(FIXTURE, 'node_modules'), path.join(app, 'node_modules'));
});

afterAll(() => {
	if (app) fs.rmSync(app, { recursive: true, force: true });
});

function build(): void {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		OGYGIA_SECRET: SECRET,
		CONTENT_E2E_KIT_VERSION: 'cold-warm'
	};
	delete env.OGYGIA_E2E_OUT_DIR;
	const res = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
		cwd: app,
		env,
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024
	});
	if (res.status !== 0)
		throw new Error(`the fixture's build failed:\n${`${res.stdout}${res.stderr}`.slice(-4000)}`);
}

/** Every file under `dir`, by its path there: its bytes, as text. */
function files(dir: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const name of fs.readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
		const abs = path.join(dir, name);
		if (fs.statSync(abs).isFile()) out.set(name, fs.readFileSync(abs, 'latin1'));
	}
	return out;
}

/** Each markup entry the build cache holds: its inode and time, which a rewrite changes. */
function markup_entries(): Map<string, string> {
	const dir = path.join(app, 'node_modules', '.ogygia', 'markup');
	const out = new Map<string, string>();
	if (!fs.existsSync(dir)) return out;
	for (const name of fs.readdirSync(dir)) {
		const stat = fs.statSync(path.join(dir, name));
		out.set(name, `${stat.ino}:${stat.mtimeMs}`);
	}
	return out;
}

test(
	'a warm build (the build cache kept) writes the same output, byte for byte, as a cold build of the same source and secret',
	() => {
		const output = path.join(app, '.svelte-kit', 'output');
		build();
		const cold = files(output);
		const cached = markup_entries();
		build();
		const warm = files(output);

		expect(cached.size).toBeGreaterThan(0);
		expect(markup_entries()).toEqual(cached);
		expect([...cold.keys()].some((name) => name.startsWith(`server${path.sep}`))).toBe(true);
		expect([...warm.keys()]).toEqual([...cold.keys()]);
		const differ = [...cold].filter(([name, text]) => warm.get(name) !== text).map(([n]) => n);
		expect(differ).toEqual([]);
	},
	BUILD_MS * 2
);
