// NO NEW UNSTRUCTURED COMMENTS. `ogygia/structured-comments` (internal/lint/comments.oxlintrc.json)
// is report-only over the whole tree: the #512 sweep still has old comments to move. This gate
// fails only on the comments a change ADDS: each finding on a line the diff against the base adds,
// in a .ts, .js or .svelte file under packages/*/src. An old comment the change leaves alone passes.
//
//   node internal/checks/new-comments.ts                 the base: NEW_COMMENTS_BASE, else HEAD^1 on a
//                                                        merge (a PR's merge ref: its base branch),
//                                                        else the merge base with origin/main
//   node internal/checks/new-comments.ts --base <rev>    against that revision
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = path.join(ROOT, 'internal/lint/comments.oxlintrc.json');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');
const SOURCE_RE = /^packages\/[^/]+\/src\/.*\.(ts|js|svelte)$/;
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** What the gate says at each comment it fails: move the why, never just delete. */
export const NEW_COMMENT =
	"turn this comment's why into a test, rule or type, then remove it; an outside fact stays as // @why <fact> (test: file › name)";

/** One comment the change adds that is not one of the structured shapes. */
export interface Finding {
	file: string;
	line: number;
	message: string;
}

const git = (cwd: string, args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

/** Each package source file the change touches, with the lines it adds (1-based, in the new file). */
export function added_lines(root: string, base: string): Map<string, Set<number>> {
	// what HEAD adds since it left `base` (as `base...HEAD`), not what `base` gained since
	const from = git(root, ['merge-base', base, 'HEAD']).trim();
	const files = git(root, ['diff', '-M', '--name-only', '--diff-filter=AMR', from, 'HEAD'])
		.split('\n')
		.filter((f) => SOURCE_RE.test(f) && !f.endsWith('.d.ts'));
	const added = new Map<string, Set<number>>();
	if (files.length === 0) return added;
	let file = '';
	for (const row of git(root, ['diff', '-M', '-U0', '--no-color', from, 'HEAD']).split('\n')) {
		if (row.startsWith('+++ ')) file = row.slice(4).replace(/^b\//, '');
		const hunk = HUNK_RE.exec(row);
		if (!hunk || !files.includes(file)) continue;
		const start = Number(hunk[1]);
		const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
		let lines = added.get(file);
		if (!lines) added.set(file, (lines = new Set()));
		for (let i = 0; i < count; i++) lines.add(start + i);
	}
	return added;
}

/** The structured-comments findings that land on a line the change adds. */
export function new_comment_findings(root: string, base: string): Finding[] {
	const added = added_lines(root, base);
	if (added.size === 0) return [];
	let out: string;
	try {
		out = execFileSync(OXLINT, ['-c', CONFIG, '-f', 'json', ...added.keys()], {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 1 << 28
		});
	} catch (e) {
		// ok: oxlint exits non-zero when it reports; its report is still on stdout
		out = (e as { stdout: string }).stdout;
	}
	const report = JSON.parse(out) as {
		diagnostics: { filename: string; message: string; labels: { span: { line: number } }[] }[];
	};
	return report.diagnostics
		.map((d) => ({
			file: path.relative(root, path.resolve(root, d.filename)).replaceAll('\\', '/'),
			line: d.labels[0]?.span.line ?? 0,
			message: d.message
		}))
		.filter((f) => added.get(f.file)?.has(f.line))
		.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** The revision a change is judged against. */
function default_base(root: string): string {
	if (process.env.NEW_COMMENTS_BASE) return process.env.NEW_COMMENTS_BASE;
	const parents = git(root, ['rev-list', '--parents', '-n1', 'HEAD']).trim().split(' ');
	if (parents.length > 2) return 'HEAD^1';
	return git(root, ['merge-base', 'origin/main', 'HEAD']).trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const at = process.argv.indexOf('--base');
	const base = at === -1 ? default_base(ROOT) : process.argv[at + 1];
	const found = new_comment_findings(ROOT, base);
	for (const f of found) console.error(`${f.file}:${f.line}: ${NEW_COMMENT}`);
	if (found.length > 0) {
		console.error(
			`\n${found.length} new comment(s) (ogygia/structured-comments; COMMENTS-ARE-TESTS in internal/notes/INVARIANTS.md)`
		);
		process.exit(1);
	}
	console.log(`no new unstructured comment against ${base}`);
}
