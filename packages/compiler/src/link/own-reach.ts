import { walk } from 'estree-walker';
import { OWN_PACKAGE_NAMES } from '@ogygia/core/contract';
import { parse_roots } from '../parse/roots.ts';
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

function static_spec(n: AstNode | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
	if (n.type === 'TemplateLiteral' && n.expressions?.length === 0)
		return n.quasis?.[0]?.value?.cooked ?? null;
	return null;
}

function name_of(n: AstNode | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Identifier') return n.name ?? null;
	if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
	return null;
}

function member_name(m: AstNode): string | null {
	return m.computed ? static_spec(m.property) : name_of(m.property);
}

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

function dynamic_reads(path: Path): string[] | null {
	let i = path.length - 1;
	let value = path[i];
	const unwrap = () => {
		while (value.parent?.type === 'ParenthesizedExpression') value = path[--i];
	};
	unwrap();
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
	if (!roots) return { names: new Set(), all: true, content: false };

	const names = new Set<string>();
	let all = false;
	let content = false;
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
				all = true;
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

	if (namespaces.size > 0 && !all)
		for (const { node, parent, key } of references) {
			if (!namespaces.has(node.name) || declarations.has(node)) continue;
			if (parent?.type === 'MemberExpression') {
				if (key === 'property' && !parent.computed) continue;
				const n = key === 'object' ? member_name(parent) : null;
				if (n != null) {
					names.add(n);
					continue;
				}
			}
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
