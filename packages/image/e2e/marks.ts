// The build's mark (`//<16 hex>.ogygia.invalid`) names an image file while a page prerenders; the
// build's end removes it. No file a build leaves may still hold one.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MARK = /[0-9a-f]{16}\.ogygia\.invalid/;

/** The files under each of `dirs` (relative to `root`) that still hold a build mark, as
 *  `<dir>/<file>`, and how many files were read. */
export function marked_files(
	root: string,
	dirs: readonly string[],
	skip: (rel: string) => boolean = () => false
): { marked: string[]; read: number } {
	const marked: string[] = [];
	let read = 0;
	for (const dir of dirs) {
		const at = path.join(root, dir);
		for (const name of fs.readdirSync(at, { recursive: true, encoding: 'utf8' })) {
			const rel = `${dir}/${name}`;
			const file = path.join(at, name);
			if (skip(rel) || !fs.statSync(file).isFile()) continue;
			read++;
			const bytes = fs.readFileSync(file);
			const plain = name.endsWith('.br')
				? zlib.brotliDecompressSync(bytes)
				: name.endsWith('.gz')
					? zlib.gunzipSync(bytes)
					: bytes;
			if (MARK.test(plain.toString('latin1'))) marked.push(rel);
		}
	}
	return { marked, read };
}
