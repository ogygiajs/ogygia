/**
 * `ogygia.files` — a dependency package DECLARES its ogygia compile surface in its OWN
 * package.json, npm-`files`-style (bare dirs recurse, globs allowed):
 *
 *     { "ogygia": { "files": ["./src/components", "./src/admin-routes.ts", "./dist/**\/*.js"] } }
 *
 * Only declared packages are ever scanned — walking every dependency would be slow AND wrong —
 * and only their declared paths. The consumer configures NOTHING: discovery reads the app's
 * direct dependencies' manifests (a handful of tiny file reads), and the plugin turns each
 * declaration into ssr.noExternal + optimizeDeps.exclude + prescan roots + transform gates.
 *
 * Everything is realpath'd: Vite resolves module ids through symlinks (pnpm), so gate matching
 * must speak real paths or every check silently misses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'tinyglobby';
import type { PackageScan } from '../ctx.ts';
import { OWN_PACKAGE_NAMES } from '@ogygia/core/contract';
import { OgygiaError, warn } from '../messages.ts';

export type { PackageScan };

const posix = (p: string) => p.split(path.sep).join('/');
/** npm-glob magic — a bare path is stat'd, anything magic goes through the glob expander. */
const GLOB_MAGIC_RE = /[*?{}[\]!]/;

function read_manifest(dir: string): Record<string, unknown> | null {
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
	} catch {
		return null;
	}
}

export function discover_package_files(app_root: string): PackageScan[] {
	const app = read_manifest(app_root);
	if (!app) return [];
	const deps = [
		...Object.keys((app.dependencies as object | undefined) ?? {}),
		...Object.keys((app.devDependencies as object | undefined) ?? {})
	];
	const found: PackageScan[] = [];
	for (const name of deps) {
		// ogygia's own compile surface (profiler UI, …) is wired internally, not via this field
		if (OWN_PACKAGE_NAMES.includes(name)) continue;
		const pkg_dir = path.join(app_root, 'node_modules', ...name.split('/'));
		const manifest = read_manifest(pkg_dir);
		const declared = (manifest?.ogygia as { files?: unknown } | undefined)?.files;
		if (declared == null) continue;
		if (!Array.isArray(declared) || !declared.every((p) => typeof p === 'string')) {
			throw new OgygiaError('package_files_not_array', {
				package: name,
				got: JSON.stringify(declared)
			});
		}
		let root: string;
		try {
			root = fs.realpathSync(pkg_dir);
		} catch {
			continue;
		}
		const dirs: string[] = [];
		const files = new Set<string>();
		// INSIDE the package, by the path a file really has (a symlink in the package leading out of
		// it is outside): an escape would widen the compile surface to unrelated code
		const inside = (real: string) => real === root || real.startsWith(root + path.sep);
		for (const entry of declared) {
			if (GLOB_MAGIC_RE.test(entry)) {
				for (const m of globSync(entry, { cwd: root, absolute: true, dot: false })) {
					let real: string;
					try {
						real = fs.realpathSync(m);
					} catch {
						continue; // ok: a dangling symlink is no file to list
					}
					// same escape rule as bare paths — `../…/**` must not widen the surface
					if (inside(real)) files.add(posix(real));
				}
				continue;
			}
			const abs = path.resolve(root, entry);
			if (!inside(abs)) throw new OgygiaError('package_files_escapes', { package: name, entry });
			let real: string;
			let stat;
			try {
				real = fs.realpathSync(abs);
				stat = fs.statSync(real);
			} catch {
				warn('package_files_missing', { package: name, entry });
				continue;
			}
			if (!inside(real)) throw new OgygiaError('package_files_escapes', { package: name, entry });
			if (stat.isDirectory()) dirs.push(posix(real));
			else files.add(posix(real));
		}
		if (dirs.length || files.size) {
			found.push({ name, root: posix(root), dirs, files: [...files] });
		}
	}
	return found;
}
