// SHIPPED COMPONENTS ARE TYPESCRIPT, AND COMPILE AS THEY SHIP. Every `.svelte` under
// `packages/*/src` ships as preprocessed source the app's own Svelte compiles
// (@ogygia/tsdown-plugin-svelte). Each one:
//   - writes every `<script>` as `lang="ts"`, with its types in TypeScript, never as JSDoc type
//     tags (`@type {…}`, `@param {…}`, `@typedef`…): one style, checked by svelte-check;
//   - holds no `<style>` literal inside a script (a preprocess pipeline that scans for style
//     elements by pattern feeds its contents to postcss, and svelte2tsx sees the script left open);
//   - compiles for the server and the client after the plugin's own preprocess and markup strip,
//     the way the app's Svelte will meet it;
//   - holds the structured-comments policy (#512) in its markup, which the linter never reads: a
//     `<!-- … -->` is a tool directive (`svelte-ignore`, a formatter ignore), the top-level
//     `@component` doc, or one line `<!-- @why <fact> (test: <file> › <name>) -->` directly above
//     what it explains, whose test exists. A package joins CLEAN_PACKAGES once its markup holds
//     no other comment; until then its markup comments are counted, not failed.
//
//   node internal/checks/shipped-svelte.ts     name each finding, failing when there is one
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, parse, preprocess, type PreprocessorGroup } from 'svelte/compiler';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { strip_markup_ts } from '@ogygia/tsdown-plugin-svelte';
import { WHY, why_test_exists } from '../lint/rules/structured-comments.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The packages whose components hold no unstructured comment, script or markup. Each one also
 *  holds `ogygia/structured-comments` as an error on its `.svelte` files (`.oxlintrc.json`). */
export const CLEAN_PACKAGES: ReadonlySet<string> = new Set([]);

/** A markup comment a tool reads, kept as it is. */
const MARKUP_DIRECTIVE = /^\s*(svelte-ignore|prettier-ignore|oxfmt-ignore)\b/;
const MARKUP_DOC = /^\s*@component\b/;

export const MARKUP_FREE =
	'a markup comment is `svelte-ignore` or a formatter ignore, the top-level `@component` doc, or `<!-- @why <fact> (test: <file> › <name>) -->`: make this one a test, a rule or clearer markup, or delete it (#512)';
export const MARKUP_WHY =
	'a markup `@why` is one line, `<!-- @why <fact> (test: <file> › <name>) -->`, on its own line directly above what it explains, and names a test that exists';

/** A JSDoc tag that carries a type: the TypeScript in the script says it instead. */
const JSDOC_TYPE_TAG =
	/@(?:type|typedef|callback|template|satisfies|import|enum|this)\b|@(?:param|arg|argument|returns?|prop|property|yields|throws)\s*\{/;

const STYLE_TAG = /<\/?style\b/;

interface Script {
	start: number;
	end: number;
	content: { start: number; end: number };
	attributes: { name: string; value: unknown }[];
}

interface Ast {
	instance?: Script | null;
	module?: Script | null;
	comments?: { value: string; start: number }[];
}

const line_at = (source: string, at: number): number => source.slice(0, at).split('\n').length;

function lang_of(script: Script): string | undefined {
	const attr = script.attributes.find((a) => a.name === 'lang');
	const value = Array.isArray(attr?.value) ? (attr.value[0] as { data?: string }) : undefined;
	return value?.data;
}

/** What one component's source breaks of the rules above (before it is compiled), as `line: why`. */
export function source_findings(source: string, filename: string): string[] {
	const ast = parse(source, { modern: true, filename }) as unknown as Ast;
	const out: string[] = [];
	for (const script of [ast.module, ast.instance]) {
		if (!script) continue;
		const line = line_at(source, script.start);
		if (lang_of(script) !== 'ts') out.push(`${line}: a <script> without lang="ts"`);
		const body = source.slice(script.content.start, script.content.end);
		const style = STYLE_TAG.exec(body);
		if (style)
			out.push(
				`${line_at(source, script.content.start + style.index)}: a <style> literal inside a <script>`
			);
	}
	for (const comment of ast.comments ?? []) {
		if (JSDOC_TYPE_TAG.test(comment.value))
			out.push(
				`${line_at(source, comment.start)}: a JSDoc type tag (write the type in TypeScript)`
			);
	}
	return out;
}

interface MarkupComment {
	data: string;
	start: number;
	end: number;
}

/** Each `<!-- … -->` in the markup, with whether it sits at the top level of the fragment. */
function markup_comments(source: string, filename: string): [MarkupComment, boolean][] {
	const ast = parse(source, { modern: true, filename }) as unknown as {
		fragment: { nodes: unknown[] };
	};
	const top = new Set(ast.fragment.nodes);
	const out: [MarkupComment, boolean][] = [];
	const walk = (n: unknown): void => {
		if (!n || typeof n !== 'object') return;
		if (Array.isArray(n)) {
			for (const x of n) walk(x);
			return;
		}
		const node = n as { type?: unknown; data?: unknown };
		if (node.type === 'Comment' && typeof node.data === 'string')
			out.push([node as MarkupComment, top.has(node)]);
		for (const [key, value] of Object.entries(node))
			if (key !== 'metadata' && value && typeof value === 'object') walk(value);
	};
	walk(ast.fragment);
	return out.sort((a, b) => a[0].start - b[0].start);
}

/** What one component's markup comments break of the structured-comments policy, as `line: why`. */
export function markup_findings(source: string, filename: string): string[] {
	const out: string[] = [];
	for (const [c, top] of markup_comments(source, filename)) {
		const line = line_at(source, c.start);
		if (MARKUP_DIRECTIVE.test(c.data) || (top && MARKUP_DOC.test(c.data))) continue;
		if (c.data.startsWith(' @why')) {
			const m = WHY.exec(c.data.trimEnd());
			const line_start = source.lastIndexOf('\n', c.start - 1) + 1;
			const own_line = source.slice(line_start, c.start).trim() === '';
			const after = source.slice(c.end).match(/^[^\S\n]*\n([^\n]*)/);
			const above = after !== null && after[1].trim() !== '';
			if (!m || !own_line || !above || !why_test_exists(filename, m[2], m[3]))
				out.push(`${line}: ${MARKUP_WHY}`);
			continue;
		}
		out.push(`${line}: ${MARKUP_FREE}`);
	}
	return out;
}

const package_of = (file: string): string => file.split('/')[1];

/** How many markup comments break the policy in each package not yet clean. */
export async function pending_markup(root: string = ROOT): Promise<Map<string, number>> {
	const pending = new Map<string, number>();
	for (const file of shipped_components(root)) {
		const pkg = package_of(file);
		if (CLEAN_PACKAGES.has(pkg)) continue;
		const abs = path.join(root, file);
		const n = markup_findings(readFileSync(abs, 'utf8'), abs).length;
		if (n > 0) pending.set(pkg, (pending.get(pkg) ?? 0) + n);
	}
	return pending;
}

/** The component as it ships: the plugin's preprocess, then its markup strip. */
export async function as_shipped(
	source: string,
	filename: string,
	pre: PreprocessorGroup = vitePreprocess({ script: true })
): Promise<string> {
	const { code } = await preprocess(source, pre, { filename });
	return strip_markup_ts(code, filename);
}

/** Whether the shipped form compiles for both targets; a top-level `await` asks for async mode. */
export function compile_findings(shipped: string, filename: string): string[] {
	const out: string[] = [];
	for (const generate of ['server', 'client'] as const) {
		try {
			try {
				compile(shipped, { filename, generate });
			} catch (error) {
				if ((error as { code?: string }).code !== 'experimental_async') throw error;
				compile(shipped, { filename, generate, experimental: { async: true } });
			}
		} catch (error) {
			out.push(`does not compile for the ${generate} as shipped: ${(error as Error).message}`);
		}
	}
	return out;
}

/** Each tracked shipped component. */
export function shipped_components(root: string = ROOT): string[] {
	return execFileSync(
		'git',
		['ls-files', '-z', 'packages/*/src/*.svelte', 'packages/*/src/**/*.svelte'],
		{
			cwd: root,
			encoding: 'utf8'
		}
	)
		.split('\0')
		.filter((file) => /^packages\/[^/]+\/src\//.test(file));
}

/** Every finding over every shipped component, as `file:line: why`. */
export async function find_all(root: string = ROOT): Promise<string[]> {
	const pre = vitePreprocess({ script: true });
	const found: string[] = [];
	for (const file of shipped_components(root)) {
		const abs = path.join(root, file);
		const source = readFileSync(abs, 'utf8');
		for (const f of source_findings(source, abs)) found.push(`${file}:${f}`);
		if (CLEAN_PACKAGES.has(package_of(file)))
			for (const f of markup_findings(source, abs)) found.push(`${file}:${f}`);
		for (const f of compile_findings(await as_shipped(source, abs, pre), abs))
			found.push(`${file}: ${f}`);
	}
	return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const found = await find_all();
	for (const at of found) console.error(at);
	for (const [pkg, n] of await pending_markup())
		console.log(`${pkg}: ${n} markup comment(s) pending (#512; not failed until it is clean)`);
	if (found.length > 0) process.exit(1);
	console.log(
		`${shipped_components().length} shipped components: TypeScript, and they compile as shipped`
	);
}
