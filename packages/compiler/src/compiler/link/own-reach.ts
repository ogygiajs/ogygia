/**
 * What a module can reach of ogygia: the names of ogygia's own exports it imports, re-exports or
 * reads off the module object, and whether it reaches `@ogygia/content`. Read from the parsed code,
 * so every form counts: a named or namespace import, a re-export from a local barrel, a star export,
 * a namespace handed on, a dynamic `import()`.
 *
 * Two runtime marks read the answer: the `context` mark (a provider ships the context bridge) and
 * `crosses_wire` (a region or content value on Kit's wire ships the codec cluster). Both must be
 * OVER: a miss drops context in islands or leaves Kit without a decoder, an extra is bytes. So every
 * form the walk cannot narrow (a star export, a namespace that escapes, a dynamic import kept whole,
 * a file that will not parse) answers `all`. Tests: test/own-reach.test.ts.
 */
import { walk } from 'estree-walker';
import { OWN_PACKAGE_NAMES } from '@ogygia/core/contract';
import { parse_roots } from './page-keys.ts';
import type { AstNode } from '../parse/oxc.ts';

/** `all`: the module can reach any of ogygia's exports. */
export type OwnReach = { names: Set<string>; all: boolean; content: boolean };

const NAMES_A_PACKAGE = /['"`](?:ogygia|@ogygia\/core|@ogygia\/content)\b/;

const CONTEXT_PROVIDERS: readonly string[] = ['Provide', 'setContext', 'createContext'];
const WIRE_PRODUCERS: readonly string[] = ['region', 'Region', 'site'];

/** The module provides cross-island context (the `context` mark). */
export function reaches_context(r: OwnReach): boolean {
	return r.all || CONTEXT_PROVIDERS.some((n) => r.names.has(n));
}

/** The module produces a value that crosses Kit's transport (`crosses_wire`). */
export function reaches_wire(r: OwnReach): boolean {
	return r.content || r.all || WIRE_PRODUCERS.some((n) => r.names.has(n));
}

function is_own(spec: unknown): boolean {
	return typeof spec === 'string' && OWN_PACKAGE_NAMES.includes(spec);
}

function is_content(spec: unknown): boolean {
	return (
		typeof spec === 'string' && (spec === '@ogygia/content' || spec.startsWith('@ogygia/content/'))
	);
}

/** A static specifier: a string literal or a template literal with no expressions. */
function static_spec(n: AstNode | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
	if (n.type === 'TemplateLiteral' && n.expressions?.length === 0)
		return n.quasis?.[0]?.value?.cooked ?? null;
	return null;
}

/** An import/export name node: an identifier or a string literal (`export { "a-b" as c }`). */
function name_of(n: AstNode | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Identifier') return n.name ?? null;
	if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
	return null;
}

/** A member read's static name: `o.x` or `o['x']`; null when computed from a value. */
function member_name(m: AstNode): string | null {
	return m.computed ? static_spec(m.property) : name_of(m.property);
}

/** The keys an object pattern takes, or null when it has a rest element or a computed key. */
function pattern_keys(p: AstNode): string[] | null {
	const keys: string[] = [];
	for (const prop of p.properties ?? []) {
		if (prop.type !== 'Property' || prop.computed) return null;
		const k = name_of(prop.key);
		if (k == null) return null;
		keys.push(k);
	}
	return keys;
}

type Path = { node: AstNode; parent: AstNode | null; key: string | null }[];

/** What the module object a dynamic `import()` yields is used for: the names it reads, or null
 *  when it is kept whole. `path` ends at the `import()` node. */
function dynamic_reads(path: Path): string[] | null {
	let i = path.length - 1;
	let value = path[i];
	const unwrap = () => {
		while (value.parent?.type === 'ParenthesizedExpression') value = path[--i];
	};
	unwrap();
	// Without an `await` the value is a promise: `.then(…)` hands the module on, so it is kept whole.
	if (value.parent?.type !== 'AwaitExpression') return null;
	value = path[--i];
	unwrap();
	const parent = value.parent;
	if (!parent) return null;
	if (parent.type === 'MemberExpression' && value.key === 'object') {
		const n = member_name(parent);
		return n == null ? null : [n];
	}
	if (
		parent.type === 'VariableDeclarator' &&
		value.key === 'init' &&
		parent.id?.type === 'ObjectPattern'
	)
		return pattern_keys(parent.id);
	return null;
}

/**
 * The ogygia exports `src` can reach. `kind` picks the parser (`'svelte'` for a component, `'script'`
 * for `.ts`/`.js`). A file that names neither package answers nothing without a parse.
 */
export function own_reach(src: string, id: string, kind: 'svelte' | 'script'): OwnReach {
	if (!NAMES_A_PACKAGE.test(src)) return { names: new Set(), all: false, content: false };
	const roots = parse_roots(src, id, kind);
	// A file that names ogygia but will not parse here: count it whole (the safe end).
	if (!roots) return { names: new Set(), all: true, content: false };

	const names = new Set<string>();
	let all = false;
	let content = false;
	// local names bound to ogygia's module object (`import * as og from 'ogygia'`)
	const namespaces = new Set<string>();
	const declarations = new Set<AstNode>();
	const references: Path = [];
	const path: Path = [];

	const take_import = (node: AstNode) => {
		const spec = node.source?.value;
		if (node.importKind === 'type') return;
		if (is_content(spec)) content = true;
		if (!is_own(spec)) return;
		for (const s of node.specifiers ?? []) {
			if (s.importKind === 'type') continue;
			if (s.type === 'ImportSpecifier') {
				const n = name_of(s.imported);
				if (n != null) names.add(n);
			} else if (s.type === 'ImportNamespaceSpecifier') {
				namespaces.add(s.local.name);
				declarations.add(s.local);
			} else {
				all = true; // a default import: not a named export of ogygia's, so count every one
			}
		}
	};

	for (const root of roots)
		walk(root as never, {
			enter(n, parent, key) {
				const node = n as unknown as AstNode;
				path.push({
					node,
					parent: parent as AstNode | null,
					key: key == null ? null : String(key)
				});
				switch (node.type) {
					case 'ImportDeclaration':
						take_import(node);
						break;
					case 'ExportNamedDeclaration': {
						const spec = node.source?.value;
						if (!spec || node.exportKind === 'type') break;
						if (is_content(spec)) content = true;
						if (!is_own(spec)) break;
						for (const s of node.specifiers ?? []) {
							if (s.exportKind === 'type') continue;
							const local = name_of(s.local);
							if (local != null) names.add(local);
						}
						break;
					}
					case 'ExportAllDeclaration': {
						if (node.exportKind === 'type') break;
						const spec = node.source?.value;
						if (is_content(spec)) content = true;
						if (is_own(spec)) all = true;
						break;
					}
					case 'ImportExpression': {
						const spec = static_spec(node.source);
						if (is_content(spec)) content = true;
						if (!is_own(spec)) break;
						const reads = dynamic_reads(path);
						if (reads == null) all = true;
						else for (const r of reads) names.add(r);
						break;
					}
					case 'Identifier':
						references.push(path[path.length - 1]);
						break;
					case 'Component': {
						// Svelte's `<og.Provide>`: a component named through a namespace
						const [head, member] = String(node.name ?? '').split('.');
						if (member && namespaces.has(head)) names.add(member);
						break;
					}
				}
			},
			leave() {
				path.pop();
			}
		});

	// A namespace read as `og.x` reaches `x`; used any other way (handed on, spread, called with), it
	// reaches every export.
	if (namespaces.size > 0 && !all)
		for (const { node, parent, key } of references) {
			if (!namespaces.has(node.name) || declarations.has(node)) continue;
			if (parent?.type === 'MemberExpression') {
				if (key === 'property' && !parent.computed) continue; // `x.og`: a property, not the binding
				const n = key === 'object' ? member_name(parent) : null;
				if (n != null) {
					names.add(n);
					continue;
				}
			}
			// a property key or an import/export's own name is not a read of the binding
			if (parent?.type === 'Property' && key === 'key' && !parent.shorthand && !parent.computed)
				continue;
			if (
				(parent?.type === 'ImportSpecifier' || parent?.type === 'ExportSpecifier') &&
				key !== 'local'
			)
				continue;
			all = true;
			break;
		}

	return { names, all, content };
}
