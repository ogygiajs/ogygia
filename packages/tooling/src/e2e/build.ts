/**
 * Build a fixture app for its e2e suite: `vite build` in the app's directory. The libraries it
 * depends on are already built: the `e2e` turbo task depends on their `build` (turbo.json). Skipped
 * under E2E_NO_BUILD=1 (reuse the app's existing build).
 *
 *   node <tooling>/src/e2e/build.ts          # the app in the current directory (a webServer command)
 *   globalSetup: <tooling>/src/e2e/build.ts  # the app in `metadata.build` (a suite with no server)
 *
 * @packageDocumentation
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FullConfig } from '@playwright/test';

/**
 * Kit's `outDir` for an e2e build, beside the app's own `.svelte-kit`: a rules build never lands
 * where a production build (the one a speed run measures) lives. Each app built for e2e reads it in
 * its svelte.config (`outDir: process.env.OGYGIA_E2E_OUT_DIR`), which is unset in any other build.
 */
export const E2E_OUT_DIR = '.svelte-kit-e2e';

/** The env of an e2e build, and of the server that serves it: rules on, Kit's output in its own folder. */
export const E2E_BUILD_ENV: Readonly<Record<string, string>> = {
	OGYGIA_RULES: '1',
	OGYGIA_E2E_OUT_DIR: E2E_OUT_DIR
};

/** A path in the e2e build of the app in `dir` (Kit's `output/`: `client`, `server`, `prerendered`). */
export function e2e_output(dir: string, ...parts: string[]): string {
	return join(dir, E2E_OUT_DIR, 'output', ...parts);
}

/** Throws unless the app in `dir` just built into its e2e folder (its svelte.config reads the env). */
export function assert_e2e_output(dir: string): void {
	if (!existsSync(e2e_output(dir)))
		throw new Error(
			`e2e build wrote no ${E2E_OUT_DIR}/output in ${dir}: its svelte.config must set kit.outDir to process.env.OGYGIA_E2E_OUT_DIR, or the rules build overwrites the production one`
		);
}

/** Kit's `sync` for the app in `dir`, into its own `.svelte-kit`: the tsconfig the app's tsconfig
 *  extends, which an e2e build (its files in {@link E2E_OUT_DIR}) never writes. */
export function sync_app(dir: string): void {
	const env = { ...process.env };
	delete env.OGYGIA_E2E_OUT_DIR;
	const res = spawnSync('node', ['node_modules/@sveltejs/kit/svelte-kit.js', 'sync'], {
		cwd: dir,
		stdio: 'inherit',
		env
	});
	if (res.status !== 0) throw new Error(`svelte-kit sync failed: ${dir}`);
}

/** Build the app in `dir`; throws (with the build's output already printed) when it fails. */
export function build_app(dir: string): void {
	if (process.env.E2E_NO_BUILD) {
		console.log(`▸ E2E_NO_BUILD=1 — reusing the existing build of ${dir}`);
		return;
	}
	sync_app(dir);
	console.log(`▸ Building ${dir}`);
	// (with ogygia's rules on itself: every test ends by reading them, ./index.ts `test`)
	const res = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
		cwd: dir,
		stdio: 'inherit',
		env: { ...process.env, ...E2E_BUILD_ENV }
	});
	if (res.status !== 0) throw new Error(`e2e build failed: ${dir}`);
	assert_e2e_output(dir);
}

/** Playwright `globalSetup`: build the app the config names in `metadata.build`. */
export default function global_build(config: FullConfig): void {
	const dir = config.metadata.build;
	if (typeof dir !== 'string')
		throw new Error('e2e build: the config names no app (metadata.build)');
	build_app(dir);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		build_app(process.cwd());
	} catch (e) {
		console.error(`\n✗ ${(e as Error).message}`);
		process.exit(1);
	}
}
