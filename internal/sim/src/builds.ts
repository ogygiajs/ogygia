/**
 * `pnpm sim:builds`: builds the app twice, the builds a run deploys between (a deploy mid-session:
 * pages of the first build still open while the second serves). Each is a rules build
 * (`OGYGIA_RULES=1`), copied from `.svelte-kit/output` to `.svelte-kit/sim-builds/<id>`.
 *
 *   node src/builds.ts [--app <dir>]
 *
 * The two differ the way two releases do: Kit's version (the build's id, read by the app's config
 * from `VITE_SIM_BUILD`: a rebuild of the same code is the same world, test/builds.test.ts), and code that
 * reads `import.meta.env.VITE_SIM_BUILD` (palaestra's Counter renders it: its chunk's hash, and
 * its HTML, are the build's own). Without them a run has one build and never deploys.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The builds a run deploys between, in order. */
export const BUILD_IDS = ['v1', 'v2'] as const;

/** Where build `id` of `app` lives. */
export const build_dir = (app: string, id: string): string =>
	join(app, '.svelte-kit', 'sim-builds', id);

/** The app's two builds when both are there, else none. */
export function builds_of(app: string): Array<{ id: string; output: string }> {
	const list = BUILD_IDS.map((id) => ({ id, output: build_dir(app, id) }));
	return list.every((b) => existsSync(join(b.output, 'server', 'index.js'))) ? list : [];
}

function main(): void {
	const at = process.argv.indexOf('--app');
	const app = resolve(
		at === -1
			? fileURLToPath(new URL('../../../apps/palaestra', import.meta.url))
			: process.argv[at + 1]
	);
	for (const id of BUILD_IDS) {
		console.log(`[sim] building ${id} of ${app}`);
		const r = spawnSync('pnpm', ['exec', 'vite', 'build'], {
			cwd: app,
			stdio: 'inherit',
			env: { ...process.env, OGYGIA_RULES: '1', VITE_SIM_BUILD: id }
		});
		if (r.status !== 0) {
			console.error(`[sim] build ${id} failed (${r.signal ?? `exit code ${r.status}`})`);
			process.exit(1);
		}
		const to = build_dir(app, id);
		rmSync(to, { recursive: true, force: true });
		cpSync(join(app, '.svelte-kit', 'output'), to, { recursive: true });
	}
	console.log(`[sim] builds ready: ${BUILD_IDS.map((id) => build_dir(app, id)).join(', ')}`);
}

if (import.meta.main) main();
