import type { SvelteNode } from './ir.ts';
import { OgygiaError } from '../messages.ts';

/** One name a marked import binds: its local name and the export it reads (`'default'` or a name). */
export interface MarkedBinding {
	local: string;
	exportName: string;
}

function line_of(src: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset; i++) if (src.charCodeAt(i) === 10) line++;
	return line;
}

function line_col(src: string, offset: number): string {
	let line = 1;
	let last = -1;
	for (let i = 0; i < offset; i++) {
		if (src.charCodeAt(i) === 10) {
			line++;
			last = i;
		}
	}
	return `${line}:${offset - last}`;
}

function export_name_of(spec: SvelteNode): string {
	if (spec.type === 'ImportDefaultSpecifier') return 'default';
	const imported = spec.imported;
	return imported?.type === 'Literal' ? String(imported.value) : String(imported?.name);
}

function binding_text(exportName: string, local: string): string {
	if (exportName === 'default') return local;
	return exportName === local ? `{ ${local} }` : `{ ${exportName} as ${local} }`;
}

/**
 * The names a marked import declaration binds, each with the export it reads. Throws the coded error
 * for a shape that binds no component: a type-only import (or a `type` specifier), a namespace, or
 * nothing at all.
 */
export function marked_import_bindings(
	node: SvelteNode,
	source: string,
	host: string
): MarkedBinding[] {
	const spec = String(node.source?.value ?? '');
	const line = line_of(source, node.start);
	const specifiers: SvelteNode[] = node.specifiers ?? [];
	const types =
		node.importKind === 'type'
			? specifiers
			: specifiers.filter((s) => s.importKind === 'type' || s.importKind === 'typeof');
	if (node.importKind === 'type' || types.length) {
		throw new OgygiaError('region_import_type_only', {
			host,
			line,
			names: types
				.map((s) => binding_text(export_name_of(s), s.local.name).replace(/^\{ | \}$/g, ''))
				.join(', '),
			spec
		});
	}
	const ns = specifiers.find((s) => s.type === 'ImportNamespaceSpecifier');
	if (ns)
		throw new OgygiaError('region_import_namespace', { host, line, name: ns.local.name, spec });
	if (specifiers.length === 0) throw new OgygiaError('region_import_bare', { host, line, spec });
	return specifiers.map((s) => ({ local: s.local.name as string, exportName: export_name_of(s) }));
}

function is_import_meta_og(node: SvelteNode, prop: string): boolean {
	return (
		node?.type === 'MemberExpression' &&
		node.property?.type === 'Identifier' &&
		node.property.name === prop &&
		node.object?.type === 'MemberExpression' &&
		node.object.property?.type === 'Identifier' &&
		node.object.property.name === 'og' &&
		node.object.object?.type === 'MetaProperty' &&
		node.object.object.meta?.name === 'import' &&
		node.object.object.property?.name === 'meta'
	);
}

const SKIP_KEYS: ReadonlySet<string> = new Set([
	'start',
	'end',
	'loc',
	'range',
	'parent',
	'metadata'
]);

function walk(
	node: unknown,
	visit: (node: SvelteNode, ancestors: SvelteNode[]) => boolean | void,
	ancestors: SvelteNode[] = []
): void {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const n of node) walk(n, visit, ancestors);
		return;
	}
	const n = node as SvelteNode;
	if (typeof n.type !== 'string') return;
	if (visit(n, ancestors) === false) return;
	ancestors.push(n);
	for (const k of Object.keys(n)) {
		if (SKIP_KEYS.has(k)) continue;
		const v = n[k];
		if (v && typeof v === 'object') walk(v, visit, ancestors);
	}
	ancestors.pop();
}

/**
 * `import.meta.og.asRegion(…)` is gone. Any call anywhere in `roots` throws `as_region_removed`,
 * listing for each call the marked import that replaces it (same options, aliased to the `const`).
 */
export function refuse_as_region(roots: unknown[], source: string, host: string): void {
	if (!source.includes('asRegion')) return;
	const imports = new Map<string, SvelteNode>();
	for (const root of roots)
		walk(root, (n) => {
			if (n.type !== 'ImportDeclaration') return;
			for (const s of n.specifiers ?? []) imports.set(s.local?.name, n);
			return false;
		});
	const fixes: string[] = [];
	for (const root of roots)
		walk(root, (n, ancestors) => {
			if (n.type !== 'CallExpression' || !is_import_meta_og(n.callee, 'asRegion')) return;
			const comp = n.arguments?.[0];
			const opts = n.arguments?.[1];
			const comp_name = comp?.type === 'Identifier' ? String(comp.name) : 'Component';
			const parent = ancestors[ancestors.length - 1];
			const local =
				parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier'
					? String(parent.id.name)
					: comp_name;
			const decl = imports.get(comp_name);
			const spec_node = decl?.specifiers?.find((s: SvelteNode) => s.local?.name === comp_name);
			const export_name =
				spec_node && spec_node.type !== 'ImportNamespaceSpecifier'
					? export_name_of(spec_node)
					: comp_name;
			const spec = decl ? source.slice(decl.source.start, decl.source.end) : `'…'`;
			const with_text = opts ? source.slice(opts.start, opts.end) : `{ wake: 'load' }`;
			fixes.push(
				`  line ${line_of(source, n.start)}: import ${binding_text(export_name, local)} from ${spec} with ${with_text};`
			);
			return false;
		});
	if (fixes.length) throw new OgygiaError('as_region_removed', { host, fixes: fixes.join('\n') });
}

function pattern_names(p: SvelteNode | null | undefined, out: Set<string>): void {
	if (!p || typeof p !== 'object') return;
	switch (p.type) {
		case 'Identifier':
			out.add(p.name);
			return;
		case 'ObjectPattern':
			for (const prop of p.properties ?? [])
				pattern_names(prop.type === 'RestElement' ? prop.argument : prop.value, out);
			return;
		case 'ArrayPattern':
			for (const el of p.elements ?? []) pattern_names(el, out);
			return;
		case 'RestElement':
			pattern_names(p.argument, out);
			return;
		case 'AssignmentPattern':
			pattern_names(p.left, out);
			return;
		case 'TSParameterProperty':
			pattern_names(p.parameter, out);
	}
}

function declared_names(roots: unknown[]): Set<string> {
	const out = new Set<string>();
	for (const root of roots)
		walk(root, (n) => {
			switch (n.type) {
				case 'ImportDeclaration':
					return false;
				case 'VariableDeclarator':
					pattern_names(n.id, out);
					break;
				case 'FunctionDeclaration':
				case 'FunctionExpression':
				case 'ArrowFunctionExpression':
					if (n.id) pattern_names(n.id, out);
					for (const p of n.params ?? []) pattern_names(p, out);
					break;
				case 'ClassDeclaration':
				case 'ClassExpression':
					if (n.id) pattern_names(n.id, out);
					break;
				case 'CatchClause':
					pattern_names(n.param, out);
					break;
				case 'EachBlock':
					pattern_names(n.context, out);
					if (typeof n.index === 'string') out.add(n.index);
					break;
				case 'AwaitBlock':
					pattern_names(n.value, out);
					pattern_names(n.error, out);
					break;
				case 'SnippetBlock':
					pattern_names(n.expression, out);
					for (const p of n.parameters ?? []) pattern_names(p, out);
					break;
				case 'LetDirective':
					if (typeof n.name === 'string') out.add(n.name);
			}
		});
	return out;
}

const DOM_ELEMENTS: ReadonlySet<string> = new Set([
	'RegularElement',
	'SvelteElement',
	'SvelteWindow',
	'SvelteDocument',
	'SvelteBody'
]);

const DIRECTIVE_USE: Record<string, string> = {
	UseDirective: 'used as an action',
	TransitionDirective: 'used as a transition',
	AnimateDirective: 'used as an animation'
};

function misuse_of(node: SvelteNode, ancestors: SvelteNode[]): string | null {
	const parent = ancestors[ancestors.length - 1];
	if (!parent) return null;
	switch (parent.type) {
		case 'CallExpression':
			if (parent.callee !== node) return null;
			return ancestors.some((a) => a.type === 'RenderTag') ? 'rendered with {@render}' : 'called';
		case 'NewExpression':
			return parent.callee === node ? 'constructed with new' : null;
		case 'TaggedTemplateExpression':
			return parent.tag === node ? 'used as a template tag' : null;
		case 'MemberExpression':
			return parent.object === node ? 'read as an object (a member access)' : null;
		case 'SpreadElement':
		case 'SpreadAttribute':
			return 'spread';
		case 'UnaryExpression':
			if (parent.operator === 'void' || parent.operator === '!') return null;
			return parent.operator === 'typeof' ? 'read with typeof' : `an operand of ${parent.operator}`;
		case 'UpdateExpression':
			return 'assigned';
		case 'AssignmentExpression':
			return parent.left === node ? 'assigned' : null;
		case 'TemplateLiteral':
			return 'put in a template string';
		case 'HtmlTag':
			return 'rendered with {@html}';
		case 'AttachTag':
			return 'used as an attachment';
		case 'OnDirective':
			return 'used as an event handler';
		case 'EachBlock':
			return parent.expression === node ? 'iterated with {#each}' : null;
		case 'AwaitBlock':
			return parent.expression === node ? 'awaited with {#await}' : null;
		case 'ExpressionTag': {
			const holder = ancestors[ancestors.length - 2];
			if (holder?.type === 'Attribute') {
				if (Array.isArray(holder.value) && holder.value.length > 1)
					return 'put in an attribute string';
				const element = ancestors[ancestors.length - 3];
				if (/^on/i.test(String(holder.name)) && DOM_ELEMENTS.has(String(element?.type)))
					return 'used as an event handler';
				return null;
			}
			return 'rendered as text';
		}
	}
	return null;
}

/**
 * A marked binding is a component: placed as `<Name />`, or handed on as a value (`region(Name)`, a
 * prop, a registry entry, an export). Any other use (a call, a member read, a spread, `typeof`, text,
 * a store subscription, an action…) throws `region_binding_not_component` at the first one, naming
 * its line and the plain import line to split it onto. `marked` maps each local to its import.
 */
export function check_marked_uses(
	roots: unknown[],
	marked: ReadonlyMap<string, { node: SvelteNode; exportName: string }>,
	source: string,
	host: string
): void {
	if (marked.size === 0) return;
	const shadowed = declared_names(roots);
	const watched = new Set([...marked.keys()].filter((n) => !shadowed.has(n)));
	if (watched.size === 0) return;
	const fail = (local: string, use: string, at: number): never => {
		const m = marked.get(local)!;
		const spec = source.slice(m.node.source.start, m.node.source.end);
		throw new OgygiaError('region_binding_not_component', {
			host,
			at: line_col(source, at),
			name: local,
			use,
			fix: `import ${binding_text(m.exportName, local)} from ${spec};`
		});
	};
	for (const root of roots)
		walk(root, (n, ancestors) => {
			if (n.type === 'ImportDeclaration' || String(n.type).startsWith('TS')) return false;
			const how = DIRECTIVE_USE[n.type];
			if (how && watched.has(n.name)) fail(n.name, how, n.start);
			if (n.type !== 'Identifier') return;
			const name = String(n.name);
			if (name.startsWith('$') && watched.has(name.slice(1)))
				fail(name.slice(1), `read as a store (${name})`, n.start);
			if (!watched.has(name)) return;
			const parent = ancestors[ancestors.length - 1];
			if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
			if (
				(parent?.type === 'Property' || parent?.type === 'MethodDefinition') &&
				parent.key === n &&
				!parent.computed &&
				!parent.shorthand
			)
				return;
			if (parent?.type === 'ExportSpecifier' && parent.exported === n && parent.local !== n) return;
			const use = misuse_of(n, ancestors);
			if (use) fail(name, use, n.start);
		});
}
