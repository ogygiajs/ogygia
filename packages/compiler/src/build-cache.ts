import fs from 'node:fs';
import path from 'node:path';

let root: string | null | undefined;
let configured: string | undefined;

/** Point the cache at a project (the Vite plugin calls this with the app root at config time). */
export function configure_build_cache(project_root: string): void {
	if (configured === project_root) return;
	configured = project_root;
	root = undefined;
}

/** Test hook: force the cache root (or `null` to disable, `undefined` to re-probe). */
export function __set_build_cache_root(dir: string | null | undefined): void {
	root = dir;
	if (dir === undefined) configured = undefined;
}

function cache_root(): string | null {
	if (root !== undefined) return root;
	try {
		const d = path.join(configured ?? process.cwd(), 'node_modules', '.ogygia');
		fs.mkdirSync(d, { recursive: true });
		root = d;
		// oxlint-disable-next-line ogygia/no-silent-failures -- a read-only install runs with no cache; the work is redone each build
	} catch {
		root = null;
	}
	return root;
}

export class BuildCache<T> {
	readonly namespace: string;

	constructor(namespace: string) {
		this.namespace = namespace;
	}

	/** This namespace's DIRECTORY, for artifact trees the consumer manages itself (git checkouts).
	 *  Returns the ensured absolute path, or `null` when the cache is unavailable. */
	dir(): string | null {
		const r = cache_root();
		if (!r) return null;
		try {
			const d = path.join(r, this.namespace);
			fs.mkdirSync(d, { recursive: true });
			return d;
			// oxlint-disable-next-line ogygia/no-silent-failures -- no cache directory is a miss; the caller does the work itself
		} catch {
			return null;
		}
	}

	get(key: string): T | null {
		const d = this.dir();
		if (!d) return null;
		try {
			return JSON.parse(fs.readFileSync(path.join(d, `${key}.json`), 'utf8')) as T;
			// oxlint-disable-next-line ogygia/no-silent-failures -- an absent or torn entry is a miss; the caller recomputes and sets it
		} catch {
			return null;
		}
	}

	set(key: string, value: T): void {
		const d = this.dir();
		if (!d) return;
		try {
			const tmp = path.join(d, `${key}.${process.pid}.tmp`);
			fs.writeFileSync(tmp, JSON.stringify(value));
			fs.renameSync(tmp, path.join(d, `${key}.json`));
			// oxlint-disable-next-line ogygia/no-silent-failures -- best effort; a failed write means a recompute next time
		} catch {}
	}
}
