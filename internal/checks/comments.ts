/**
 * The #512 sweep's inventory: every comment `ogygia/structured-comments` reports under a path,
 * as a count per file, or (`--table`) as the rows of a sweep PR's table, each waiting for its rung.
 *
 *   node internal/checks/comments.ts packages/router/src
 *   node internal/checks/comments.ts packages/router/src --table
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const path = process.argv[2] ?? 'packages';
const table = process.argv.includes('--table');

let out: string;
try {
	out = execFileSync(
		join(root, 'node_modules/.bin/oxlint'),
		['-c', 'internal/lint/comments.oxlintrc.json', '-f', 'json', path],
		{ cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }
	);
} catch (e) {
	out = (e as { stdout: string }).stdout;
}
type Diagnostic = {
	filename: string;
	message: string;
	labels: { span: { offset: number; length: number; line: number } }[];
};
const found = (JSON.parse(out) as { diagnostics: Diagnostic[] }).diagnostics
	.filter((d) => (d as { code?: string }).code?.includes('structured-comments') ?? true)
	.map((d) => ({
		file: d.filename.replace(`${root}/`, ''),
		span: d.labels[0].span,
		message: d.message
	}))
	.sort((a, b) => a.file.localeCompare(b.file) || a.span.line - b.span.line);

if (!table) {
	const per = new Map<string, number>();
	for (const f of found) per.set(f.file, (per.get(f.file) ?? 0) + 1);
	for (const [file, n] of [...per].sort((a, b) => b[1] - a[1]))
		console.log(`${String(n).padStart(5)}  ${file}`);
	console.log(`${String(found.length).padStart(5)}  total`);
} else {
	const texts = new Map<string, Buffer>();
	console.log('| where | comment | rung | proof |');
	console.log('| --- | --- | --- | --- |');
	for (const f of found) {
		if (!texts.has(f.file)) texts.set(f.file, readFileSync(join(root, f.file)));
		const text = (texts.get(f.file) ?? Buffer.alloc(0))
			.subarray(f.span.offset, f.span.offset + f.span.length)
			.toString('utf8')
			.replace(/^\/[/*]+|\*\/$/g, '')
			.replace(/\s*\n\s*\*?\s*/g, ' ')
			.trim();
		const cell = (text.length > 100 ? `${text.slice(0, 97)}…` : text).replaceAll('|', '\\|');
		console.log(`| \`${f.file}:${f.span.line}\` | ${cell} |  |  |`);
	}
}
