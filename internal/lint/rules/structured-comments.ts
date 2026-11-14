import { readFileSync } from 'node:fs';
import {
	ALL_SOURCE,
	OK_NOTE,
	type Comment,
	type Context,
	type Node,
	type Ranged
} from './shared.ts';

type FullComment = Comment & { range: [number, number]; loc: { start: { line: number } } };

/** Directives a tool reads, which say why after ` -- `. */
const REASONED =
	/^\s*(oxlint-disable(-next-line|-line)?|eslint-disable(-next-line|-line)?|@ts-expect-error)\b/;
/** Directives a tool reads, which need no reason. */
const FREE =
	/^\s*(oxlint-enable|eslint-enable|svelte-ignore|[@#]__PURE__|[@#]__NO_SIDE_EFFECTS__|@vite-ignore|oxfmt-ignore|prettier-ignore|\/ <reference )/;
/** A `@why` line's text after `//` (or inside `<!-- … -->`, trimmed at the end): the fact, the
 *  test file and the test's name. */
export const WHY = /^ @why (\S.*?) \(test: (\S+) › (.+)\)$/;
/** A JSDoc that is only a type (`@type {…}`, `@satisfies {…}`): the checker reads it, as in a
 *  `.svelte` file's JS script. Its text, `*` gutters dropped, is the tag and its braces alone. */
const TYPE_ONLY = /^@(type|satisfies)\s*\{[\s\S]*\}$/;
/** TSDoc's file-level block: it documents the module, so it sits before any code. */
const PACKAGE_DOC = /(^|\s)@packageDocumentation(\s|$)/;

const MESSAGE_FREE =
	'A comment in package source is JSDoc on an export, a tool directive (`-- <reason>`), an `// ok: <reason>` note on a failure that is fine, or `// @why <fact> (test: <file> › <name>)`. Make this one a test, a rule, a type or clearer code, or delete it (#512).';
const MESSAGE_JSDOC =
	'JSDoc documents an export (or a member of an exported class or type). This one sits on something not exported: make it a clearer name, a test or a type, or delete it (#512).';
const MESSAGE_REASON =
	'A directive says why after ` -- `: `oxlint-disable-next-line <rule> -- <reason>`.';
const MESSAGE_WHY =
	'A `@why` is one line, `// @why <fact> (test: <file> › <name>)`, directly above the statement it explains, and names a test that exists (the file, from the package or the repository root, holds the name).';

/** The start of every node whose JSDoc feeds an export's hover: exported declarations and the
 *  members of exported classes, types and object constants, everything in an ambient block, and a
 *  component's props type (the type of its `$props()`) with its members. */
function documentable(program: Node): Set<number> {
	const starts = new Set<number>();
	const named = new Set<string>();
	for (const s of program.body as Node[])
		if (s.type === 'ExportNamedDeclaration' && !s.declaration)
			for (const spec of (s.specifiers as Node[]) ?? [])
				named.add((spec.local as { name?: string }).name ?? '');
	const walk = (n: unknown, all: boolean): void => {
		if (!n || typeof n !== 'object') return;
		if (Array.isArray(n)) {
			for (const x of n) walk(x, all);
			return;
		}
		const node = n as Ranged;
		if (typeof node.type !== 'string') return;
		if (all || MEMBER.has(node.type)) starts.add(node.range[0]);
		const code = node.type.includes('Function') || node.type === 'StaticBlock';
		for (const key in node) {
			if (key === 'parent' || key === 'loc' || key === 'range') continue;
			if (code && !all && key === 'body') continue;
			const v = node[key];
			if (v && typeof v === 'object') walk(v, all);
		}
	};
	for (const s of program.body as Node[])
		if (s.type === 'VariableDeclaration')
			for (const d of s.declarations as Node[]) {
				const init = d.init as Node | null;
				if (init?.type !== 'CallExpression') continue;
				if ((init.callee as { name?: string }).name !== '$props') continue;
				const type = (d.id as { typeAnnotation?: { typeAnnotation?: Node } }).typeAnnotation
					?.typeAnnotation;
				if (type?.type === 'TSTypeReference')
					named.add((type.typeName as { name?: string }).name ?? '');
				else if (type) walk(type, false);
			}
	const declared_name = (d: Node): string | undefined =>
		(d.id as { name?: string } | undefined)?.name ??
		((d.declarations as Node[] | undefined)?.[0]?.id as { name?: string } | undefined)?.name;
	for (const s of program.body as Ranged[]) {
		const ambient =
			(s.type === 'TSModuleDeclaration' && s.declare === true) ||
			(s.type === 'TSModuleDeclaration' && (s as { kind?: string }).kind === 'global');
		if (ambient) {
			walk(s, true);
			continue;
		}
		if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') {
			starts.add(s.range[0]);
			walk(s.declaration, false);
			const d = s.declaration as Node | undefined;
			if (d?.type === 'TSModuleDeclaration') walk(d, true);
		} else {
			const name = declared_name(s);
			if (name !== undefined && named.has(name)) {
				starts.add(s.range[0]);
				walk(s, false);
			}
		}
	}
	return starts;
}

const MEMBER = new Set([
	'MethodDefinition',
	'PropertyDefinition',
	'AccessorProperty',
	'TSPropertySignature',
	'TSMethodSignature',
	'TSIndexSignature',
	'TSCallSignatureDeclaration',
	'TSConstructSignatureDeclaration',
	'TSEnumMember',
	'Property'
]);

const test_files = new Map<string, string | null>();
function test_text(path: string): string | null {
	if (!test_files.has(path)) {
		let text: string | null;
		try {
			text = readFileSync(path, 'utf8');
		} catch {
			text = null;
		}
		test_files.set(path, text);
	}
	return test_files.get(path) ?? null;
}

/** Does the `@why`'s test exist: a file (from the package or the repository root) holding the name? */
export function why_test_exists(file: string, test: string, test_name: string): boolean {
	const m = ALL_SOURCE.exec(file);
	if (!m) return false;
	const root = file.slice(0, m.index + m[1].length);
	for (const base of [`${root}packages/${m[2]}/`, root]) {
		const text = test_text(base + test);
		if (text !== null && text.includes(test_name)) return true;
	}
	return false;
}

/**
 * `ogygia/structured-comments` (#512): in `packages/<pkg>/src`, a comment is one of three shapes:
 * JSDoc on an export (or on a member of an exported class, type or object constant, on a
 * component's props type and its members, or a `@packageDocumentation` block before any code), a
 * tool directive (`oxlint-disable…` and
 * `@ts-expect-error` with ` -- <reason>`; `svelte-ignore`, `@__PURE__`, `@vite-ignore`, formatter
 * ignores, `/// <reference>` as they are; a JSDoc that is only `@type {…}` or `@satisfies {…}`), a
 * line `// ok: <reason>` (the note the no-silent-failures rules ask for), or a one-line
 * `// @why <fact> (test: <file> › <name>)` directly above its statement, whose test
 * exists. A bin's `#!` line is not a comment. Anything else is a finding. `.d.ts` files are
 * documented like exports and are not read.
 */
export const structured_comments = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Package source comments are JSDoc on exports, reasoned directives, or tested @why lines.'
		}
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!ALL_SOURCE.test(file) || file.endsWith('.d.ts')) return {};
		return {
			Program(program: Node) {
				const source = context as {
					sourceCode?: { getAllComments?: () => FullComment[]; text?: string };
				};
				const comments = source.sourceCode?.getAllComments?.() ?? [];
				const text = source.sourceCode?.text ?? '';
				let starts: Set<number> | null = null;
				for (const c of comments) {
					const node = c as unknown as Node;
					const value = c.value;
					if (c.range[0] === 0 && text.startsWith('#!')) continue;
					if (REASONED.test(value)) {
						if (!/\s--\s+\S/.test(value)) context.report({ node, message: MESSAGE_REASON });
						continue;
					}
					if (FREE.test(value)) continue;
					if (c.type === 'Line' && OK_NOTE.test(value)) continue;
					if (c.type === 'Block' && value.startsWith('*')) {
						if (PACKAGE_DOC.test(value) && text.slice(0, c.range[0]).trim() === '') continue;
						if (TYPE_ONLY.test(value.replace(/^[^\S\n]*\*/gm, '').trim())) continue;
						starts ??= documentable(program);
						const next = text.slice(c.range[1]).search(/\S/);
						if (next < 0 || !starts.has(c.range[1] + next))
							context.report({ node, message: MESSAGE_JSDOC });
						continue;
					}
					if (c.type === 'Line' && value.startsWith(' @why')) {
						const m = WHY.exec(value);
						const line_start = text.lastIndexOf('\n', c.range[0] - 1) + 1;
						const own_line = text.slice(line_start, c.range[0]).trim() === '';
						const after = text.slice(c.range[1]).match(/^[^\S\n]*\n([^\n]*)/);
						const above = after !== null && after[1].trim() !== '';
						if (!m || !own_line || !above || !why_test_exists(file, m[2], m[3]))
							context.report({ node, message: MESSAGE_WHY });
						continue;
					}
					context.report({ node, message: MESSAGE_FREE });
				}
			}
		};
	}
};
