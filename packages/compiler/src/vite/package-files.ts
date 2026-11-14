import fs from 'node:fs';
import path from 'node:path';
import { globSync } from 'tinyglobby';
import type { PackageScan } from '../ctx.ts';
import { OWN_PACKAGE_NAMES } from '@ogygia/core/contract';
import { OgygiaError, warn } from '../messages.ts';

export type { PackageScan };

const posix = (p: string) => p.split(path.sep).join('/');
const GLOB_MAGIC_RE = /[*?{}[\]!]/;

function read_manifest(dir: string): Record<string, unknown> | null {
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
	} catch {
		return null; // ok: no manifest, or one that does not parse, declares nothing
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
		if (OWN_PACKAGE_NAMES.includes(name)) continue;
		let root: string;
		try {
			root = fs.realpathSync(path.join(app_root, 'node_modules', ...name.split('/')));
		} catch {
			continue; // ok: a dependency not installed under this root declares nothing
		}
		const manifest = read_manifest(root);
		const declared = (manifest?.ogygia as { files?: unknown } | undefined)?.files;
		if (declared == null) continue;
		if (!Array.isArray(declared) || !declared.every((p) => typeof p === 'string')) {
			throw new OgygiaError('package_files_not_array', {
				package: name,
				got: JSON.stringify(declared)
			});
		}
		const dirs: string[] = [];
		const files = new Set<string>();
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
