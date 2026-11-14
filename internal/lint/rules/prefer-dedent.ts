/**
 * `ogygia/prefer-dedent`: text of several lines is written as lines, in one `dedent` template
 * (`dedent.inline` for text that ends up on one line). It flags a string or template literal with
 * two or more `\n` escapes, and an array of string pieces joined with `'\n'` (not one line of text
 * with newlines only at its edges, nor a template whose only text is `\n` between its values:
 * values joined by newlines, not prose). No fix: a hand
 * conversion proves its bytes the same.
 */

import fs from 'node:fs';
import path from 'node:path';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { concat_kept, unwrap, type FixContext, type Node, type Ranged } from './shared.ts';

const MESSAGE_DEDENT =
	'Write text of several lines as its lines, in one `dedent` template (core contract/dedent.ts; `dedent.inline` for one line written as a block).';

/** How many `\n` escapes a literal's source text holds (an escaped backslash before `n` is not one). */
function newline_escapes(raw: string): number {
	let n = 0;
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] !== '\\') continue;
		if (raw[i + 1] === 'n') n++;
		i++;
	}
	return n;
}

const ONLY_NEWLINES_RE = /^\n*$/;

/** A template whose only text is `\n` between its values (`${a}\n${b}\n`): values joined by
 *  newlines, with no lines of its own to write (internal/lint/prefer-dedent.test.ts). */
function newline_joined(node: Node): boolean {
	if ((node.expressions as Node[]).length === 0) return false;
	return (node.quasis as { value: { cooked: string | null } }[]).every(
		(q) => q.value.cooked !== null && ONLY_NEWLINES_RE.test(q.value.cooked)
	);
}

const is_text_piece = (e: Node): boolean => {
	const n = unwrap(e);
	return (n.type === 'Literal' && typeof n.value === 'string') || n.type === 'TemplateLiteral';
};

/** A value's stand-in while the fixer proves a conversion (a character no text holds). */
const VALUE_MARK = '\u0001';
/** Text a conversion leaves alone: a control character it cannot write as itself. (Script and
 *  preformatted text convert like any other: the proof keeps their bytes.) */
function leave_text(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f) return true;
	}
	return false;
}
/** In a .svelte or HTML file, a template holding `</script` would close its own script block. */
const CLOSE_SCRIPT_RE = /<\/script/i;
const EDGE_NEWLINES_G = /^\n+|\n+$/g;
/** A node whose string cannot become a template: a key, a type, a module specifier. */
const KEEP_PARENTS = new Set([
	'ImportDeclaration',
	'ExportNamedDeclaration',
	'ExportAllDeclaration',
	'ImportExpression',
	'TSLiteralType',
	'TSEnumMember',
	'TSExternalModuleReference',
	'TSModuleDeclaration',
	'ImportAttribute'
]);

/** Where `dedent` comes from for a file, or null where it must not be imported (a package core
 *  depends on, or the CLI that runs before an app has core). */
function dedent_source(file: string): string | null {
	const f = file.replaceAll('\\', '/');
	const core = f.indexOf('/packages/core/');
	if (core !== -1) {
		const from = path.posix.dirname(f);
		const to = `${f.slice(0, core)}/packages/core/src/contract/dedent.ts`;
		const rel = path.posix.relative(from, to);
		return rel.startsWith('.') ? rel : `./${rel}`;
	}
	// (the compiler reaches core only through its contract: ogygia/compiler-boundary)
	if (f.includes('/packages/compiler/')) return '@ogygia/core/contract';
	if (/\/packages\/(machine|tooling|config|tsdown-plugin-svelte)\//.test(f)) return null;
	if (f.endsWith('/packages/cli/src/cli.ts')) return null;
	// (a package that reaches core: its package.json names @ogygia/core or ogygia)
	let dir = path.posix.dirname(f);
	for (;;) {
		const pkg = `${dir}/package.json`;
		if (fs.existsSync(pkg)) {
			const json = JSON.parse(fs.readFileSync(pkg, 'utf8')) as Record<
				string,
				Record<string, string>
			>;
			const deps = { ...json.dependencies, ...json.devDependencies, ...json.peerDependencies };
			if ('@ogygia/core' in deps) return '@ogygia/core/plugin/utils';
			if ('ogygia' in deps) return 'ogygia/plugin/utils';
			return null;
		}
		const up = path.posix.dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

/** The fix for a literal of several lines, as a `dedent` template, or null when the real `dedent`
 *  does not give back the literal's exact text. `cooked`: its text, values as `VALUE_MARK<i>`. */
function dedent_fix(
	context: FixContext,
	node: Ranged,
	cooked: string,
	values: string[]
): { text: string; needs_import: boolean } | null {
	const plain = cooked.replaceAll(VALUE_MARK, '');
	if (leave_text(plain)) return null;
	if (/\.(svelte|html)$/.test(context.filename ?? '') && CLOSE_SCRIPT_RE.test(plain)) return null;
	// the newlines at each end are written outside the template (dedent trims blank edges)
	const lead_n = /^\n*/.exec(cooked)![0].length;
	const tail_n = /\n*$/.exec(cooked.slice(lead_n))![0].length;
	const body = cooked.slice(lead_n, cooked.length - tail_n);
	const lead = '\\n'.repeat(lead_n);
	const tail = '\\n'.repeat(tail_n);
	if (body === '' || !body.includes('\n')) return null;
	const line_text = context.sourceCode.lines[node.loc.start.line - 1] ?? '';
	const indent = /^[\t ]*/.exec(line_text)![0];
	const inner = `${indent}\t`;
	const escape = (s: string) => s.replace(/\\|`|\$\{/g, (m) => `\\${m}`);
	const lines = body.split('\n');
	// the source of the template, values back in place
	const value_at = new RegExp(`${VALUE_MARK}(\\d+)${VALUE_MARK}`, 'g');
	const raw = lines
		.map((l) =>
			l === '' ? '' : `${inner}${escape(l).replace(value_at, (_, i) => `\${${values[Number(i)]}}`)}`
		)
		.join('\n');
	// the proof: the real dedent over the same template (values as marks) gives the body back
	const strings: string[] = [];
	const marks: string[] = [];
	const full = ['', ...lines.map((l) => (l === '' ? '' : `${inner}${l}`)), indent].join('\n');
	let at = 0;
	for (const m of full.matchAll(value_at)) {
		strings.push(full.slice(at, m.index));
		marks.push(m[0]);
		at = m.index! + m[0].length;
	}
	strings.push(full.slice(at));
	const tsa = Object.assign([...strings], { raw: strings }) as unknown as TemplateStringsArray;
	if (dedent(tsa, ...marks) !== body) return null;
	const template = ['dedent`', raw, `${indent}\``].join('\n');
	const text = lead || tail ? `\`${lead}\${${template}}${tail}\`` : template;
	return { text, needs_import: true };
}

/** Whether the module already has a binding named `dedent`. */
function has_dedent(program: Node): boolean {
	for (const s of program.body as Node[]) {
		if (s.type === 'ImportDeclaration')
			for (const spec of s.specifiers as Node[])
				if ((spec.local as { name?: string }).name === 'dedent') return true;
		if (s.type === 'FunctionDeclaration' && (s.id as { name?: string })?.name === 'dedent')
			return true;
		if (s.type === 'VariableDeclaration')
			for (const d of s.declarations as Node[])
				if ((d.id as { name?: string }).name === 'dedent') return true;
	}
	return false;
}

const program_of = (n: Node): Node => {
	let p = n;
	while (p.parent) p = p.parent as Node;
	return p;
};

export const prefer_dedent = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		docs: { description: 'Text of several lines is one dedent template.' }
	},
	create(context: FixContext) {
		const text = (n: Node) => context.sourceCode.getText(n as Ranged);
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		const source = dedent_source(file);
		/** A string or template literal's text, each value as a mark (its source pushed to
		 *  `values`), or null when it cannot be read as text. */
		const cooked_text = (n: Node, values: string[]): string | null => {
			if (n.type === 'Literal')
				return typeof n.value === 'string' && !n.value.includes(VALUE_MARK) ? n.value : null;
			if (n.type !== 'TemplateLiteral') return null;
			const quasis = n.quasis as { value: { cooked: string | null } }[];
			const expressions = n.expressions as Node[];
			const out: string[] = [];
			for (let i = 0; i < quasis.length; i++) {
				const c = quasis[i]!.value.cooked;
				if (c === null || c.includes(VALUE_MARK)) return null;
				out.push(c);
				if (i < expressions.length) {
					out.push(`${VALUE_MARK}${values.length}${VALUE_MARK}`);
					values.push(text(expressions[i]!));
				}
			}
			return out.join('');
		};
		const report = (node: Node, cooked: string | null, values: string[]) => {
			// (newlines only at its edges: one line of text, set apart; no block to write)
			if (cooked !== null && !cooked.replace(EDGE_NEWLINES_G, '').includes('\n')) return;
			// (text left as it is: CRLF or control characters a template cannot write as themselves,
			// and a closing script tag inside a .svelte or HTML script block)
			if (cooked !== null) {
				const plain = cooked.replaceAll(VALUE_MARK, '');
				if (leave_text(plain)) return;
				if (/\.(svelte|html)$/.test(file) && CLOSE_SCRIPT_RE.test(plain)) return;
			}
			if (cooked === null) {
				context.report({ node, message: MESSAGE_DEDENT });
				return;
			}
			const parent = node.parent as Node | undefined;
			// (a key, a type or a specifier cannot be a template; a script() body ships as written)
			if (
				KEEP_PARENTS.has(parent?.type ?? '') ||
				(parent?.type === 'Property' && parent.key === node) ||
				(parent?.type === 'PropertyDefinition' && parent.key === node) ||
				concat_kept(node)
			)
				return;
			// text no dedent template gives back exactly (an indent of its own, a line of only
			// spaces) is left as it is
			const fix = dedent_fix(context, node as Ranged, cooked, values);
			if (!fix) return;
			if (source === null) {
				context.report({ node, message: MESSAGE_DEDENT });
				return;
			}
			const program = program_of(node);
			context.report({
				node,
				message: MESSAGE_DEDENT,
				fix: (fixer) => {
					const out = [fixer.replaceText(node as Ranged, fix.text)];
					if (!has_dedent(program)) {
						const imports = (program.body as Node[]).filter((s) => s.type === 'ImportDeclaration');
						const last = imports[imports.length - 1] as Ranged | undefined;
						const line = `import { dedent } from '${source}';`;
						out.push(
							last
								? fixer.insertTextAfter(last, `\n${line}`)
								: fixer.insertTextBefore(program as Ranged, `${line}\n`)
						);
					}
					return out;
				}
			});
		};
		return {
			Literal(node: Node) {
				if (typeof node.value !== 'string') return;
				if (newline_escapes(text(node)) < 2) return;
				report(node, node.value.includes(VALUE_MARK) ? null : node.value, []);
			},
			TemplateLiteral(node: Node) {
				// (a tagged template is its tag's text: `dedent` itself, `html`, a regex builder)
				if ((node.parent as Node | undefined)?.type === 'TaggedTemplateExpression') return;
				let n = 0;
				for (const q of node.quasis as Node[]) n += newline_escapes(text(q));
				if (n < 2 || newline_joined(node)) return;
				const values: string[] = [];
				report(node, cooked_text(node, values), values);
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee.type !== 'MemberExpression') return;
				if ((callee.property as { name?: string })?.name !== 'join') return;
				const arg = (node.arguments as Node[])[0];
				if (
					!arg ||
					unwrap(arg).type !== 'Literal' ||
					(unwrap(arg) as { value?: unknown }).value !== '\n'
				)
					return;
				const array = unwrap(callee.object as Node);
				if (array.type !== 'ArrayExpression') return;
				const elements = (array.elements as (Node | null)[]).filter((e): e is Node => e !== null);
				if (elements.length < 2 || !elements.every(is_text_piece)) return;
				// the pieces joined as `join` joins them, as one text
				const values: string[] = [];
				let cooked: string | null = '';
				for (const e of elements) {
					const piece = cooked_text(unwrap(e), values);
					if (piece === null) {
						cooked = null;
						break;
					}
					cooked = cooked === '' && e === elements[0] ? piece : `${cooked}\n${piece}`;
				}
				report(node, cooked, values);
			}
		};
	}
};
