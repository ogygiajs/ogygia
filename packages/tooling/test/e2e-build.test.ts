// The e2e harness's build step (src/e2e/build.ts): a fixture app is built once before its suite,
// from its own directory (a webServer command) or from `metadata.build` (a Playwright globalSetup).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import global_build, { build_app } from '../src/e2e/build.ts';

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

	it('E2E_NO_BUILD=1 reuses the existing build: nothing is built', () => {
		vi.stubEnv('E2E_NO_BUILD', '1');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		expect(() => build_app(temp())).not.toThrow();
	});

	it('a build that fails throws, naming the app', () => {
		vi.stubEnv('E2E_NO_BUILD', '');
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const dir = temp();
		expect(() => build_app(dir)).toThrow(`e2e build failed: ${dir}`);
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
});
