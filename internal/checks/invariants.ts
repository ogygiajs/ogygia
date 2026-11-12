#!/usr/bin/env node
/**
 * INVARIANTS ARE ENFORCED. Every section of internal/notes/INVARIANTS.md names what enforces it on
 * one `**Enforced by:**` line, as backticked items, and each item must exist:
 *
 * - `rule_<name>`: a rule registered in package source (`.add('rule_<name>', …)`, ../../packages/core/src/rules.ts);
 * - `ogygia/<name>`: a lint rule of ../lint/plugin.ts, switched on in the root `.oxlintrc.json`;
 * - `<path>` or `<path> > <text>`: a file of the repository (a test, a check, a type), which holds
 *   `<text>` when one is given (a test's name, a type's name).
 *
 * A section with no line, an empty line, or an item that names nothing that exists fails. So does a
 * citation in the repository's files (`INVARIANTS HOLE-TRUST`, `(SPA-HEAD, …/INVARIANTS.md)`) that
 * names an invariant INVARIANTS.md does not have: a cite of a rule nobody wrote is a wish. Run from
 * the repository root: `node internal/checks/invariants.ts` (CI runs its test with the lint tests).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The sections that are not invariants (links out). */
const NOT_INVARIANTS = new Set(['Related docs']);
const ENFORCED_RE = /^\*\*Enforced by:\*\*(.*)$/;
const ITEM_RE = /`([^`]+)`/g;

/** One invariant section: its heading and the items its line names (null: no line). */
export interface InvariantSection {
	readonly name: string;
	readonly items: readonly string[] | null;
}

/** The invariant sections of INVARIANTS.md's text, each with its `Enforced by:` items. */
export function read_sections(markdown: string): InvariantSection[] {
	const out: Array<{ name: string; items: string[] | null }> = [];
	let current: { name: string; items: string[] | null } | null = null;
	for (const line of markdown.split('\n')) {
		const heading = /^## (.+)$/.exec(line);
		if (heading) {
			const name = heading[1].split(' — ')[0].trim();
			current = NOT_INVARIANTS.has(name) ? null : { name, items: null };
			if (current) out.push(current);
			continue;
		}
		const enforced = current && ENFORCED_RE.exec(line.trim());
		if (current && enforced) {
			current.items ??= [];
			for (const m of enforced[1].matchAll(ITEM_RE)) current.items.push(m[1].trim());
		}
	}
	return out;
}

/** What the repository holds that an item can name. */
export interface Repo {
	/** Is there a file at this repository path? */
	has_file(rel: string): boolean;
	/** The text of a repository file. */
	read(rel: string): string;
	/** The rule codes registered in package source. */
	rule_codes(): ReadonlySet<string>;
	/** The lint rules the plugin defines and the root config switches on. */
	lint_rules(): ReadonlySet<string>;
	/** The repository files that may cite an invariant by name (source, tests, notes, docs). */
	citing_files(): readonly string[];
}

/** What is wrong with one item (null: it names something that exists). */
export function check_item(item: string, repo: Repo): string | null {
	if (/^rule_[a-z0-9_]+$/.test(item))
		return repo.rule_codes().has(item) ? null : `no rule registers \`${item}\``;
	if (/^ogygia\/[a-z0-9-]+$/.test(item))
		return repo.lint_rules().has(item)
			? null
			: `\`${item}\` is not a lint rule switched on in .oxlintrc.json`;
	const [file, needle] = item.split(' > ').map((s) => s.trim());
	if (!/\.[a-z]+$/.test(file)) return `\`${item}\` names no rule, lint rule or file`;
	if (!repo.has_file(file)) return `\`${file}\` does not exist`;
	if (needle !== undefined && !repo.read(file).includes(needle))
		return `\`${file}\` holds no \`${needle}\``;
	return null;
}

/** An invariant's name as a citation writes it (`HOLE-TRUST`, `PROBE-THEN-RENDER`). */
const NAME_RE = /\b[A-Z]{2,}(?:-[A-Z]{2,})+\b/g;
/** A line that ends mid-list: its citation goes on to the next line (`CAPABILITY-URL and`). */
const GOES_ON_RE = /(?:\band|\bor|,|\(|·)\s*$/;

/**
 * The invariant names a file's text cites: every name on a line that mentions INVARIANTS, and on the
 * next line when the citation goes on there (`INVARIANTS CAPABILITY-URL and` / `PRELOAD-CACHE)`).
 */
export function cited_names(text: string): Array<{ line: number; name: string }> {
	const out: Array<{ line: number; name: string }> = [];
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].includes('INVARIANTS')) continue;
		const cited = GOES_ON_RE.test(lines[i]) && i + 1 < lines.length ? [i, i + 1] : [i];
		for (const at of cited)
			for (const m of lines[at].matchAll(NAME_RE)) out.push({ line: at + 1, name: m[0] });
	}
	return out;
}

/** Every problem with INVARIANTS.md's enforcement lines (none: every invariant is enforced), and
 *  every citation of an invariant that INVARIANTS.md does not have. */
export function check_invariants(markdown: string, repo: Repo): string[] {
	const problems: string[] = [];
	const sections = read_sections(markdown);
	if (sections.length === 0) problems.push('INVARIANTS.md has no sections');
	const names = new Set(sections.map((s) => s.name));
	for (const file of repo.citing_files())
		for (const { line, name } of cited_names(repo.read(file)))
			if (!names.has(name))
				problems.push(`${file}:${line}: cites INVARIANTS ${name}, which is not one`);
	for (const s of sections) {
		if (s.items === null) problems.push(`${s.name}: no "**Enforced by:**" line`);
		else if (s.items.length === 0) problems.push(`${s.name}: its "Enforced by" line names nothing`);
		else
			for (const item of s.items) {
				const problem = check_item(item, repo);
				if (problem !== null) problems.push(`${s.name}: ${problem}`);
			}
	}
	return problems;
}

const RULE_ADD_RE = /\.add\(\s*['"](rule_[a-z0-9_]+)['"]/g;
/** The files a citation can sit in (a changelog says what was, under the names it had then). */
const CITING_FILE_RE = /\.(ts|js|svelte|md)$/;

function source_files(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name === 'dist') continue;
		const p = path.join(dir, name);
		if (statSync(p).isDirectory()) source_files(p, out);
		else if (/\.(ts|svelte)$/.test(name)) out.push(p);
	}
	return out;
}

/** The repository at `root`, read from disk. */
export function disk_repo(root: string): Repo {
	let codes: Set<string> | null = null;
	let lint: Set<string> | null = null;
	return {
		has_file: (rel) => existsSync(path.join(root, rel)) && statSync(path.join(root, rel)).isFile(),
		citing_files: () =>
			execFileSync('git', ['ls-files', '--', 'packages', 'apps', 'internal'], {
				cwd: root,
				encoding: 'utf8'
			})
				.split('\n')
				.filter(
					(f) =>
						CITING_FILE_RE.test(f) &&
						!f.endsWith('CHANGELOG.md') &&
						f !== 'internal/notes/INVARIANTS.md' &&
						!f.startsWith('internal/checks/invariants')
				),
		read: (rel) => readFileSync(path.join(root, rel), 'utf8'),
		rule_codes() {
			if (codes) return codes;
			codes = new Set();
			const packages = path.join(root, 'packages');
			for (const pkg of readdirSync(packages)) {
				const src = path.join(packages, pkg, 'src');
				if (!existsSync(src)) continue;
				for (const file of source_files(src))
					for (const m of readFileSync(file, 'utf8').matchAll(RULE_ADD_RE)) codes.add(m[1]);
			}
			return codes;
		},
		lint_rules() {
			if (lint) return lint;
			const config = JSON.parse(readFileSync(path.join(root, '.oxlintrc.json'), 'utf8')) as {
				rules?: Record<string, unknown>;
			};
			const plugin = readFileSync(path.join(root, 'internal/lint/plugin.ts'), 'utf8');
			lint = new Set();
			for (const [name, level] of Object.entries(config.rules ?? {})) {
				if (!name.startsWith('ogygia/') || level === 'off') continue;
				if (plugin.includes(`'${name.slice('ogygia/'.length)}':`)) lint.add(name);
			}
			return lint;
		}
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = process.cwd();
	const problems = check_invariants(
		readFileSync(path.join(root, 'internal/notes/INVARIANTS.md'), 'utf8'),
		disk_repo(root)
	);
	if (problems.length > 0) {
		console.error('INVARIANTS.md: an invariant is not enforced\n' + problems.join('\n'));
		process.exit(1);
	}
	console.log('INVARIANTS.md: every invariant names an enforcer that exists');
}
