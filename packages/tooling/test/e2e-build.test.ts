// The e2e harness's build step (src/e2e/build.ts): a fixture app is built once before its suite,
// from its own directory (a webServer command) or from `metadata.build` (a Playwright globalSetup).
import { spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import global_build, { build_app, E2E_OUT_DIR } from '../src/e2e/build.ts';

const SCRIPT = fileURLToPath(new URL('../src/e2e/build.ts', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('e2e build', () => {
	const dirs: string[] = [];
	const temp = () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2e-build-')));
		dirs.push(dir);
		return dir;
	};
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});
	/** An app in `dir` whose vite runs `vite_code`, and whose Kit's `sync` writes its tsconfig into
	 *  the folder its svelte.config names (`.svelte-kit` unless the e2e env sets one). */
	const stand_ins = (dir: string, vite_code: string) => {
		mkdirSync(join(dir, 'node_modules/vite/bin'), { recursive: true });
		writeFileSync(join(dir, 'node_modules/vite/bin/vite.js'), vite_code);
		mkdirSync(join(dir, 'node_modules/@sveltejs/kit'), { recursive: true });
		writeFileSync(
			join(dir, 'node_modules/@sveltejs/kit/svelte-kit.js'),
			"const fs = require('node:fs'); const out = process.env.OGYGIA_E2E_OUT_DIR || '.svelte-kit'; if (process.argv[2] === 'sync') { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(out + '/tsconfig.json', '{}'); }"
		);
	};

	it('E2E_NO_BUILD=1 reuses the existing build: nothing is built', () => {
		vi.stubEnv('E2E_NO_BUILD', '1');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		expect(() => build_app(temp())).not.toThrow();
	});

	it('a build that fails throws, naming the app', () => {
		vi.stubEnv('E2E_NO_BUILD', '');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = temp();
		stand_ins(dir, 'process.exit(1);');
		expect(() => build_app(dir)).toThrow(`e2e build failed: ${dir}`);
	});

	it('an app whose Kit cannot sync throws before building, naming the app', () => {
		vi.stubEnv('E2E_NO_BUILD', '');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = temp();
		expect(() => build_app(dir)).toThrow(`svelte-kit sync failed: ${dir}`);
	});

	it("the build carries ogygia's rules (OGYGIA_RULES=1), so every test's rules check checks (#1272)", () => {
		vi.stubEnv('E2E_NO_BUILD', '');
		vi.stubEnv('OGYGIA_RULES', '');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = temp();
		stand_ins(
			dir,
			"const fs = require('node:fs'); fs.writeFileSync('seen.txt', String(process.env.OGYGIA_RULES)); fs.mkdirSync(process.env.OGYGIA_E2E_OUT_DIR + '/output', { recursive: true });"
		);
		build_app(dir);
		expect(readFileSync(join(dir, 'seen.txt'), 'utf8')).toBe('1');
	});

	it("a fresh checkout's build finds the tsconfig the app extends: Kit's sync writes .svelte-kit first", () => {
		vi.stubEnv('E2E_NO_BUILD', '');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = temp();
		stand_ins(
			dir,
			"const fs = require('node:fs'); if (!fs.existsSync('.svelte-kit/tsconfig.json')) process.exit(1); fs.mkdirSync(process.env.OGYGIA_E2E_OUT_DIR + '/output', { recursive: true });"
		);
		expect(() => build_app(dir)).not.toThrow();
	});

	it("the build lands in its own folder, never over the app's production build in .svelte-kit", () => {
		vi.stubEnv('E2E_NO_BUILD', '');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = temp();
		stand_ins(
			dir,
			"require('node:fs').writeFileSync('out.txt', String(process.env.OGYGIA_E2E_OUT_DIR)); require('node:fs').mkdirSync('.svelte-kit/output', { recursive: true });"
		);
		expect(() => build_app(dir)).toThrow(
			`e2e build wrote no ${E2E_OUT_DIR}/output in ${dir}: its svelte.config must set kit.outDir`
		);
		expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe(E2E_OUT_DIR);
		expect(E2E_OUT_DIR).not.toBe('.svelte-kit');
	});

	it('as a globalSetup it builds the app in metadata.build', () => {
		vi.stubEnv('E2E_NO_BUILD', '1');
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = temp();
		global_build({ metadata: { build: dir } } as unknown as FullConfig);
		expect(log.mock.calls.join('\n')).toContain(dir);
	});

	it('run as a command it builds the app in the current directory', () => {
		const dir = temp();
		const r = spawnSync(process.execPath, [SCRIPT], {
			cwd: dir,
			env: { ...process.env, E2E_NO_BUILD: '1' },
			encoding: 'utf8'
		});
		expect(r.status).toBe(0);
		expect(r.stdout).toContain(`reusing the existing build of ${dir}`);
	});

	it("the e2e task builds the app's libraries first, so the build step builds only the app", () => {
		const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
		expect(turbo.tasks.e2e.dependsOn).toContain('^build');
	});

	it("a package's e2e task builds the libraries its fixture app installs before the app starts", () => {
		const packages = join(ROOT, 'packages');
		const missing: string[] = [];
		for (const pkg of readdirSync(packages)) {
			const e2e = join(packages, pkg, 'e2e');
			if (!existsSync(e2e)) continue;
			for (const app of readdirSync(e2e)) {
				const dir = join(e2e, app);
				if (!existsSync(join(dir, 'vite.config.ts')) || !existsSync(join(dir, 'package.json')))
					continue;
				const name: string = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;
				const own = join(packages, pkg, 'turbo.json');
				const depends: string[] = existsSync(own)
					? (JSON.parse(readFileSync(own, 'utf8')).tasks?.e2e?.dependsOn ?? [])
					: [];
				if (!depends.includes(`${name}#fixture`) || !depends.includes('build'))
					missing.push(`packages/${pkg}/turbo.json e2e needs "build" and "${name}#fixture"`);
			}
		}
		expect(missing).toEqual([]);
	});
});
