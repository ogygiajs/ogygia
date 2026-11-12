/**
 * THE FILE SEAM. Every read of an app's files goes through one `Fs` on the `CompileCtx`, so a whole
 * compile can run on files held in memory (the compiler DST harness edits them and compares a dev
 * session with a cold one). `node_fs` is the disk; `memory_fs` is a map. test/fs-seam.test.ts counts
 * the direct `node:fs` calls left in the compiler, each with its reason.
 */
import fs from 'node:fs';
import path from 'node:path';

/** A directory entry as the directory itself lists it: a link is a `link`, not what it points at
 *  (`stat` follows it). */
export interface FsEntry {
	readonly name: string;
	readonly kind: 'file' | 'dir' | 'link' | 'other';
}

export interface Fs {
	/** The file's text (UTF-8, as stored: a byte-order mark is kept), or `null` when it can't be read. */
	read(abs: string): string | null;
	/** The directory's entries, or `null` when it can't be listed. */
	list(dir: string): readonly FsEntry[] | null;
	/** What is at `abs`, links followed; `null` when nothing (or a dangling link) is. */
	stat(abs: string): 'file' | 'dir' | null;
}

const kind_of = (e: fs.Dirent): FsEntry['kind'] =>
	e.isFile() ? 'file' : e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'other';

/** The disk. */
export const node_fs: Fs = {
	read(abs) {
		try {
			return fs.readFileSync(abs, 'utf-8');
		} catch {
			return null; // ok: unreadable reads as absent, the contract above
		}
	},
	list(dir) {
		try {
			return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ name: e.name, kind: kind_of(e) }));
		} catch {
			return null; // ok: not a listable directory, the contract above
		}
	},
	stat(abs) {
		try {
			const st = fs.statSync(abs);
			return st.isFile() ? 'file' : st.isDirectory() ? 'dir' : null;
		} catch {
			return null; // ok: nothing there, the contract above
		}
	}
};

export interface MemoryFs extends Fs {
	/** Write a file (its directories appear with it), or remove it with `null` (an emptied
	 *  directory goes too). */
	set(abs: string, text: string | null): void;
	/** Every file, sorted by path. */
	files(): string[];
}

/** Files held in memory, by absolute path. Directories are the paths' parents; listings are sorted. */
export function memory_fs(initial: Record<string, string> = {}): MemoryFs {
	const files = new Map<string, string>();
	const norm = (p: string) => path.resolve(p);
	for (const [k, v] of Object.entries(initial)) files.set(norm(k), v);
	const is_dir = (abs: string) => {
		const prefix = abs.endsWith(path.sep) ? abs : abs + path.sep;
		for (const f of files.keys()) if (f.startsWith(prefix)) return true;
		return false;
	};
	return {
		read: (abs) => files.get(norm(abs)) ?? null,
		list(dir) {
			const d = norm(dir);
			if (!is_dir(d)) return null;
			const prefix = d.endsWith(path.sep) ? d : d + path.sep;
			const out = new Map<string, FsEntry['kind']>();
			for (const f of files.keys()) {
				if (!f.startsWith(prefix)) continue;
				const rest = f.slice(prefix.length);
				const cut = rest.indexOf(path.sep);
				if (cut < 0) out.set(rest, 'file');
				else out.set(rest.slice(0, cut), 'dir');
			}
			return [...out]
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([name, kind]) => ({ name, kind }));
		},
		stat(abs) {
			const p = norm(abs);
			return files.has(p) ? 'file' : is_dir(p) ? 'dir' : null;
		},
		set(abs, text) {
			if (text === null) files.delete(norm(abs));
			else files.set(norm(abs), text);
		},
		files: () => [...files.keys()].sort()
	};
}
