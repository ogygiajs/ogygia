import fs from 'node:fs';
import path from 'node:path';

const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const BACKSLASH_G = /\\/g;

interface Manifest {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

/**
 * Which modules are dependencies, not app code: a module under `node_modules`, or under the real
 * directory of a package the app installs as a link (a workspace package), followed through each
 * linked package's own dependencies. The app's own directory is never a dependency, even inside a
 * linked package (an example app inside the package it uses).
 */
export class Dependencies {
	readonly #linked: string[] = [];
	readonly #seen = new Set<string>();
	readonly #root: string;

	constructor(root: string) {
		this.#root = `${fs.realpathSync(root).replace(BACKSLASH_G, '/')}/`;
		this.#seen.add(this.#root.slice(0, -1));
		const app = Dependencies.#manifest(root);
		if (app) this.#walk(root, app, true);
	}

	#walk(dir: string, manifest: Manifest, own: boolean): void {
		const names = new Set([
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
			...Object.keys(manifest.optionalDependencies ?? {}),
			...(own ? Object.keys(manifest.devDependencies ?? {}) : [])
		]);
		for (const name of names) {
			const at = Dependencies.#installed(dir, name);
			if (at === null || NODE_MODULES_RE.test(`${at}/`) || this.#seen.has(at)) continue;
			this.#seen.add(at);
			this.#linked.push(`${at}/`);
			const next = Dependencies.#manifest(at);
			if (next) this.#walk(at, next, false);
		}
	}

	/** The real directories of the linked packages, each ending in `/`. */
	get linked(): readonly string[] {
		return this.#linked;
	}

	/** Is the module `id` (a clean absolute path) a dependency? */
	has(id: string): boolean {
		if (NODE_MODULES_RE.test(id)) return true;
		if (id.startsWith(this.#root)) return false;
		for (const dir of this.#linked) if (id.startsWith(dir)) return true;
		return false;
	}

	static #manifest(dir: string): Manifest | null {
		try {
			return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Manifest;
			// oxlint-disable-next-line ogygia/no-silent-failures -- a directory without a readable package.json lists no dependencies
		} catch {
			return null;
		}
	}

	static #installed(from: string, name: string): string | null {
		for (let dir = from; ; dir = path.dirname(dir)) {
			const at = path.join(dir, 'node_modules', name);
			try {
				return fs.realpathSync(at).replace(BACKSLASH_G, '/');
			} catch {
				// oxlint-disable-next-line ogygia/no-silent-failures -- not installed anywhere above: no directory to add
				if (path.dirname(dir) === dir) return null;
			}
		}
	}
}
