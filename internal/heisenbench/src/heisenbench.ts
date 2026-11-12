/**
 * Where Heisenbench comes from, and where the bench files are.
 *
 * Heisenbench lives in ogygiajs/bench (packages/heisenbench), not on npm. A bench file imports its API as
 * `@bench/heisenbench/bench`; `link_heisenbench` makes that name resolve by linking the root
 * `node_modules/@bench/heisenbench` to a Heisenbench checkout:
 *
 * - `HEISENBENCH_DIR` set: that directory (the bench repo's runner sets it to its own packages/heisenbench, so a
 *   bench run and its types use the Heisenbench that measures).
 * - otherwise: a clone of the bench repo at the ref pinned in this package's package.json, kept in
 *   the gitignored `.heisenbench/` at the repository root and installed once per ref.
 *
 * The checkout stays outside node_modules on purpose: Node strips TypeScript types only outside
 * node_modules, and Heisenbench ships its source as .ts.
 */
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT: string = fileURLToPath(new URL('../../../', import.meta.url));

interface HeisenbenchPin {
	repo: string;
	ref: string;
}

function read_pin(): HeisenbenchPin {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
		heisenbench: HeisenbenchPin;
	};
	return pkg.heisenbench;
}

function run(cmd: string, args: string[], cwd: string): void {
	execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

function has_commit(dir: string, ref: string): boolean {
	try {
		execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: dir, stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** The Heisenbench package directory (packages/heisenbench of a bench checkout), fetched when needed. */
export function heisenbench_dir(): string {
	const from_env = process.env.HEISENBENCH_DIR;
	if (from_env) {
		const dir = resolve(from_env);
		if (!existsSync(join(dir, 'src', 'cli.ts')))
			throw new Error(`HEISENBENCH_DIR=${from_env} is not a Heisenbench package (no src/cli.ts)`);
		return dir;
	}
	const pin = read_pin();
	const cache = join(REPO_ROOT, '.heisenbench');
	const clone = join(cache, 'bench');
	const stamp = join(cache, 'ready');
	const ready = existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === pin.ref;
	if (!ready) {
		mkdirSync(cache, { recursive: true });
		if (!existsSync(join(clone, '.git'))) {
			run(
				'git',
				['clone', '--quiet', '--filter=blob:none', '--no-checkout', pin.repo, clone],
				cache
			);
		}
		if (!has_commit(clone, pin.ref)) run('git', ['fetch', '--quiet', 'origin', pin.ref], clone);
		run('git', ['checkout', '--quiet', '--force', pin.ref], clone);
		run('pnpm', ['install', '--frozen-lockfile', '--filter', 'heisenbench'], clone);
		writeFileSync(stamp, `${pin.ref}\n`);
	}
	return join(clone, 'packages', 'heisenbench');
}

/** Point `node_modules/@bench/heisenbench` (at the repository root) at `dir`. */
export function link_heisenbench(dir: string): void {
	const link = join(REPO_ROOT, 'node_modules', '@bench', 'heisenbench');
	mkdirSync(dirname(link), { recursive: true });
	let stat = null;
	try {
		stat = lstatSync(link);
	} catch {
		stat = null;
	}
	if (stat) {
		if (!stat.isSymbolicLink()) throw new Error(`${link} exists and is not a link`);
		rmSync(link);
	}
	symlinkSync(relative(dirname(link), dir), link, 'dir');
}

/** Every package with bench files: its directory and its `bench/*.bench.ts` files. */
export function bench_packages(): Array<{ dir: string; files: string[] }> {
	const packages = join(REPO_ROOT, 'packages');
	const out: Array<{ dir: string; files: string[] }> = [];
	for (const name of readdirSync(packages).sort()) {
		const bench = join(packages, name, 'bench');
		if (!existsSync(bench)) continue;
		const files = readdirSync(bench)
			.filter((f) => f.endsWith('.bench.ts'))
			.sort()
			.map((f) => join(bench, f));
		if (files.length > 0) out.push({ dir: join(packages, name), files });
	}
	return out;
}
