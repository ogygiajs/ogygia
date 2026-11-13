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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The builds a run deploys between, in order. */
export const BUILD_IDS = ['v1', 'v2'] as const;

/** Where build `id` of `app` lives. */
export const build_dir = (app: string, id: string): string =>
	join(app, '.svelte-kit', 'sim-builds', id);

/** The release a generated app is upgraded from (its plan's `released`: src/gen.ts
 *  `released_plan`), or null. */
export function released_of(app: string): string | null {
	const file = join(app, 'src', 'lib', 'gen', 'plan.json');
	if (!existsSync(file)) return null;
	const plan = JSON.parse(readFileSync(file, 'utf8')) as { released?: string | null };
	return plan.released ?? null;
}

/** Where an app upgraded from a release builds its first build: a copy of the app with that
 *  release installed, so the build's servers import the release's packages, not this tree's. */
export const released_app = (app: string): string => join(app, '.svelte-kit', 'sim-released');

/** Where build `id` of `app` is: an upgraded app's first build is its released copy's. */
export function output_of(app: string, id: string, released: boolean): string {
	return build_dir(released && id === BUILD_IDS[0] ? released_app(app) : app, id);
}

/** The app's two builds when both are there, else none. */
export function builds_of(app: string): Array<{ id: string; output: string; released?: string }> {
	const release = released_of(app);
	const list = BUILD_IDS.map((id) => ({
		id,
		output: output_of(app, id, release !== null),
		...(release !== null && id === BUILD_IDS[0] ? { released: release } : {})
	}));
	return list.every((b) => existsSync(join(b.output, 'server', 'index.js'))) ? list : [];
}

/** The packages a released copy pins to the versions the app has installed: the same Kit, Svelte
 *  and Vite build both releases. */
const PINNED: readonly string[] = [
	'@sveltejs/kit',
	'@sveltejs/adapter-node',
	'@sveltejs/vite-plugin-svelte',
	'svelte',
	'vite'
];

/** The generated app's own files a released copy leaves out: the ones that use what the release
 *  has not got ({@link RELEASED_FILES} stands in for them). */
const LEFT_OUT: ReadonlySet<string> = new Set(['hooks.server.ts', 'sim-client.ts']);

/** The released copy's own config and hooks: the generated app's, with only ogygia's plugin and
 *  handle, as the release spelled them. */
const RELEASED_FILES: Readonly<Record<string, string>> = {
	'svelte.config.js': `import adapter from '@sveltejs/adapter-node';

export default {
	compilerOptions: { experimental: { async: true } },
	kit: {
		adapter: adapter(),
		experimental: { remoteFunctions: true },
		version: { name: process.env.VITE_SIM_BUILD }
	}
};
`,
	'vite.config.ts': `import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

const presets = Object.fromEntries(
	['2s', '30s'].flatMap((maxAge) =>
		[undefined, 'load', 'idle', 'visible', 'interaction'].map((fetch) => [
			\`hole-\${maxAge}\${fetch ? \`-\${fetch}\` : ''}\`,
			{ render: 'deferred', maxAge, ...(fetch ? { fetch } : {}) }
		])
	)
);
const plan = existsSync('src/lib/gen/plan.json')
	? JSON.parse(readFileSync('src/lib/gen/plan.json', 'utf8'))
	: {};

export default defineConfig({
	plugins: [
		ogygia({ router: plan.router !== false, presets: { ...presets, ...plan.presets } }),
		sveltekit()
	]
});
`,
	'src/hooks.server.ts': `import * as ogygia from 'ogygia/server';

export const handle = ogygia.handle();
`
};

/** Builds `app`'s first build on ogygia `release` in its released copy (installed once per set of
 *  versions), into the copy's own `.svelte-kit/sim-builds`. */
function build_released(app: string, release: string, id: string): void {
	const dir = released_app(app);
	mkdirSync(dir, { recursive: true });
	const version = (name: string) =>
		(
			JSON.parse(readFileSync(join(app, 'node_modules', name, 'package.json'), 'utf8')) as {
				version: string;
			}
		).version;
	const manifest = `${JSON.stringify(
		{
			name: 'sim-gen-released',
			private: true,
			type: 'module',
			dependencies: { ogygia: release },
			devDependencies: Object.fromEntries(PINNED.map((name) => [name, version(name)]))
		},
		null,
		'\t'
	)}\n`;
	const manifest_file = join(dir, 'package.json');
	const installed =
		existsSync(join(dir, 'node_modules', 'ogygia')) &&
		existsSync(manifest_file) &&
		readFileSync(manifest_file, 'utf8') === manifest;
	if (!installed) {
		writeFileSync(manifest_file, manifest);
		console.log(`[sim] installing ogygia ${release} in ${dir}`);
		const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
			cwd: dir,
			stdio: 'inherit'
		});
		if (r.status !== 0) fail(`installing ogygia ${release}`, r);
	}
	rmSync(join(dir, 'src'), { recursive: true, force: true });
	cpSync(join(app, 'src'), join(dir, 'src'), {
		recursive: true,
		filter: (from) => !LEFT_OUT.has(relative(join(app, 'src'), from))
	});
	for (const [file, text] of Object.entries(RELEASED_FILES)) writeFileSync(join(dir, file), text);
	console.log(`[sim] building ${id} of ${app} on ogygia ${release}`);
	const r = spawnSync(join(dir, 'node_modules', '.bin', 'vite'), ['build'], {
		cwd: dir,
		stdio: 'inherit',
		env: { ...process.env, OGYGIA_RULES: '1', VITE_SIM_BUILD: id }
	});
	if (r.status !== 0) fail(`build ${id}`, r);
	const to = build_dir(dir, id);
	rmSync(to, { recursive: true, force: true });
	cpSync(join(dir, '.svelte-kit', 'output'), to, { recursive: true });
}

function fail(what: string, r: { signal: string | null; status: number | null }): never {
	console.error(`[sim] ${what} failed (${r.signal ?? `exit code ${r.status}`})`);
	process.exit(1);
}

function main(): void {
	const at = process.argv.indexOf('--app');
	const app = resolve(
		at === -1
			? fileURLToPath(new URL('../../../apps/palaestra', import.meta.url))
			: process.argv[at + 1]
	);
	const release = released_of(app);
	for (const id of BUILD_IDS) {
		if (release !== null && id === BUILD_IDS[0]) {
			build_released(app, release, id);
			continue;
		}
		console.log(`[sim] building ${id} of ${app}`);
		const r = spawnSync('pnpm', ['exec', 'vite', 'build'], {
			cwd: app,
			stdio: 'inherit',
			env: { ...process.env, OGYGIA_RULES: '1', VITE_SIM_BUILD: id }
		});
		if (r.status !== 0) fail(`build ${id}`, r);
		const to = build_dir(app, id);
		rmSync(to, { recursive: true, force: true });
		cpSync(join(app, '.svelte-kit', 'output'), to, { recursive: true });
	}
	const ready = BUILD_IDS.map((id) => output_of(app, id, release !== null));
	console.log(`[sim] builds ready: ${ready.join(', ')}`);
}

if (import.meta.main) main();
