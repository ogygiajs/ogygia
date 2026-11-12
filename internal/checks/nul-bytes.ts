// NO RAW NUL BYTE IN SOURCE (#1239). A NUL byte (0x00) makes grep and rg read the whole file as
// binary and skip it without a word: a search for a name there finds nothing, and the name looks
// unused. A string that needs one writes the escape (`\0`, `\u0000`), the same value at runtime.
//
//   node internal/checks/nul-bytes.ts          name each file and line, failing when there is one
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The 1-based lines of `bytes` that hold a NUL byte. */
export function nul_lines(bytes: Uint8Array): number[] {
	const lines: number[] = [];
	let line = 1;
	for (const byte of bytes) {
		if (byte === 0x0a) line++;
		else if (byte === 0 && lines.at(-1) !== line) lines.push(line);
	}
	return lines;
}

/** Each tracked file under `packages/*\/src` with a NUL byte, as `file:line`. */
export function find_nul_bytes(root: string = ROOT): string[] {
	const files = execFileSync('git', ['ls-files', '-z', 'packages/*/src/**'], {
		cwd: root,
		encoding: 'utf8'
	})
		.split('\0')
		.filter(Boolean);
	return files.flatMap((file) =>
		nul_lines(readFileSync(path.join(root, file))).map((line) => `${file}:${line}`)
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const found = find_nul_bytes();
	for (const at of found) {
		console.error(
			`${at}: a raw NUL byte (grep and rg skip this file). Write it as \\0 or \\u0000.`
		);
	}
	if (found.length > 0) process.exit(1);
	console.log('no NUL byte in packages/*/src');
}
