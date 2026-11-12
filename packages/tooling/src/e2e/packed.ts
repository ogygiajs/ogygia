// The packed (published-shape) `ogygia` for the suites that install it outside the workspace.
// `ogygia` is a thin package over `@ogygia/core` and depends on it by exact version, which the
// registry may not have yet: the app gets every tarball, and its own pnpm-workspace.yaml overrides
// each released-together package with its tarball, so the install never asks the registry for one.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './paths.ts';

/** The `ogygia` package apps install (packages/ogygia) and the core it re-exports (packages/core). */
export const OGYGIA_DIR = join(REPO, 'packages', 'ogygia');
export const CORE_DIR = join(REPO, 'packages', 'core');

/** What `ogygia` pulls in that is released with it (so the registry may not have it yet): core, the
 *  machine core depends on, and the insights and compiler `ogygia` depends on. */
const RELEASED_WITH: Record<string, string> = {
	'@ogygia/core': CORE_DIR,
	'@ogygia/machine': join(REPO, 'packages', 'machine'),
	'@ogygia/insights': join(REPO, 'packages', 'insights'),
	'@ogygia/compiler': join(REPO, 'packages', 'compiler')
};

export interface PackedOgygia {
	ogygia: string;
	core: string;
	/** every released-together package's tarball, by name (core among them) */
	with: Record<string, string>;
}

/** `pnpm pack` one package into `dest`; the tarball's absolute path. */
export function pack(dir: string, dest: string): string {
	const out = spawnSync('pnpm', ['pack', '--pack-destination', dest], {
		cwd: dir,
		encoding: 'utf8'
	});
	if (out.status !== 0) throw new Error(`pnpm pack failed in ${dir}:\n${out.stderr}`);
	const line = out.stdout.trim().split('\n').pop()!.trim();
	return line.startsWith('/') ? line : join(dest, line.split('/').pop()!);
}

/** Pack `ogygia` and every package released with it (all already built) into `dest`. */
export function pack_ogygia(dest: string): PackedOgygia {
	const with_ = Object.fromEntries(
		Object.entries(RELEASED_WITH).map(([name, dir]) => [name, pack(dir, dest)])
	);
	return { ogygia: pack(OGYGIA_DIR, dest), core: with_['@ogygia/core'], with: with_ };
}

/** Point the app at the packed `ogygia`: its dependency, plus an override per released-together
 *  package in the app's own pnpm-workspace.yaml (which makes the app its own workspace root: install
 *  it WITHOUT `--ignore-workspace`, or the overrides are ignored). */
export function use_packed(app: string, packed: PackedOgygia): void {
	const pkg_file = join(app, 'package.json');
	const pkg = JSON.parse(readFileSync(pkg_file, 'utf8'));
	pkg.dependencies = { ...pkg.dependencies, ogygia: `file:${packed.ogygia}` };
	writeFileSync(pkg_file, `${JSON.stringify(pkg, null, 2)}\n`);
	const ws = join(app, 'pnpm-workspace.yaml');
	const before = existsSync(ws) ? readFileSync(ws, 'utf8') : '';
	if (/^overrides:/m.test(before))
		throw new Error(`${ws} already has overrides: merge them by hand`);
	const lines = Object.entries(packed.with).map(([name, tgz]) => `  '${name}': 'file:${tgz}'\n`);
	writeFileSync(
		ws,
		`${before}${before && !before.endsWith('\n') ? '\n' : ''}overrides:\n${lines.join('')}`
	);
}
