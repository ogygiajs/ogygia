import path from 'node:path';
import { parse_module } from './parse/oxc.ts';
import { component_blocks } from './parse/scan.ts';
import { OgygiaError } from './messages.ts';
import { splice_text, type Edit } from './splice.ts';

const CLASS_KW = /\bclass\b/;
const SVELTE_EXT = /\.svelte$/;

const GENERATED_MARK = '// ogygia: generated registration (transportable codecs)';

function parse_body(code: string, id_n: string): AstNode[] | null {
	const { program } = parse_module(code, id_n);
	return program ? ((program as { body?: AstNode[] }).body ?? []) : null;
}

type WireExport = { tag: string; local: string };

function exportedWireClasses(code: string, id_n: string): WireExport[] {
	const body = parse_body(code, id_n);
	return body ? exportedWireClassesFromBody(body, code, id_n) : [];
}

function exportedWireClassesFromBody(body: AstNode[], code: string, id_n: string): WireExport[] {
	const classNodes = new Map<string, AstNode>();
	const exported = new Map<string, string>();
	for (const node of body) {
		if (node.type === 'ClassDeclaration' && node.id) {
			classNodes.set(node.id.name, node);
		} else if (node.type === 'ExportNamedDeclaration') {
			if (node.declaration?.type === 'ClassDeclaration' && node.declaration.id?.name) {
				classNodes.set(node.declaration.id.name, node.declaration as AstNode);
				exported.set(node.declaration.id.name, node.declaration.id.name);
			}
			if (!node.source) {
				for (const spec of node.specifiers ?? []) {
					if (spec.local?.type === 'Identifier') exported.set(spec.local.name, spec.local.name);
				}
			}
		} else if (node.type === 'ExportDefaultDeclaration') {
			const decl = node.declaration as AstNode | null | undefined;
			if (decl?.type === 'ClassDeclaration' && decl.id?.name) {
				classNodes.set(decl.id.name, decl);
				exported.set('default', decl.id.name);
			} else if (decl?.type === 'ClassDeclaration' && classHasWireMember(decl)) {
				throw new OgygiaError('wire_class_anonymous', {
					file: id_n,
					line: code.slice(0, decl.start ?? 0).split('\n').length
				});
			} else if (decl?.type === 'Identifier' && decl.name) exported.set('default', decl.name);
		}
	}
	return [...exported].flatMap(([tag, local]) => {
		const cls = classNodes.get(local);
		return cls && classHasWireMember(cls) ? [{ tag, local }] : [];
	});
}

interface ExprNode {
	type?: string;
	name?: string;
	computed?: boolean;
	value?: unknown;
	callee?: ExprNode;
	object?: ExprNode;
	property?: { name?: string };
	meta?: { name?: string };
	arguments?: { type?: string; value?: unknown }[];
}

function classHasWireMember(cls: AstNode): boolean {
	const members = (cls.body as { body?: ClassMember[] } | undefined)?.body ?? [];
	return members.some((m) => {
		if (m.static !== true) return false;
		if (m.computed === true && isWireSymbolKey(m.key)) return true;
		return isWireMacroCall(m.value);
	});
}

function isWireSymbolKey(key: unknown): boolean {
	const k = key as ExprNode | undefined;
	if (k?.type !== 'CallExpression') return false;
	const callee = k.callee;
	if (
		callee?.type !== 'MemberExpression' ||
		callee.object?.name !== 'Symbol' ||
		callee.property?.name !== 'for'
	) {
		return false;
	}
	const arg = k.arguments?.[0];
	return arg?.type === 'Literal' && arg.value === 'ogygia.wire';
}

function isWireMacroCall(value: unknown): boolean {
	const v = value as ExprNode | undefined;
	if (v?.type !== 'CallExpression') return false;
	const callee = v.callee;
	if (callee?.type !== 'MemberExpression' || callee.computed || callee.property?.name !== 'wire') {
		return false;
	}
	const og = callee.object;
	if (og?.type !== 'MemberExpression' || og.computed || og.property?.name !== 'og') return false;
	const meta = og.object;
	return (
		meta?.type === 'MetaProperty' && meta.meta?.name === 'import' && meta.property?.name === 'meta'
	);
}

interface AstNode {
	type: string;
	name?: string;
	start?: number;
	id?: { name: string } | null;
	declaration?: AstNode | null;
	source?: unknown;
	specifiers?: { local?: { type: string; name: string } }[];
	body?: { body?: ClassMember[] } | AstNode[];
	static?: boolean;
	computed?: boolean;
}
interface ClassMember {
	type: string;
	static?: boolean;
	computed?: boolean;
	key?: unknown;
	value?: unknown;
}

/**
 * Does this module define an exported class carrying a transportable codec? Used to build the
 * class loaders, the eager-registration manifest and the `wire` mark, so islands never need a
 * manual `import` of the class. The registration's own question ({@link appendTransportRegistrations}),
 * asked of raw or rewritten source alike, so the two cannot disagree.
 *
 * Over-approximates: a module it cannot parse may still define one, so it counts (a miss loses the
 * loader and the wire mark; an extra loads one module). Test: transportables-prescan.test.ts.
 */
export function moduleHasTransportable(code: string, id_n: string): boolean {
	if (!CLASS_KW.test(code) || !code.includes('static')) return false;
	const body = parse_body(code, id_n);
	return body === null || exportedWireClassesFromBody(body, code, id_n).length > 0;
}

/**
 * Append `__register_transportable` calls for every exported class in this module. Returns
 * the augmented code, or null when there is no exported class. Append-only — the module's
 * existing sourcemap stays valid.
 */
export function appendTransportRegistrations(
	code: string,
	id_n: string,
	root: string
): string | null {
	if (code.includes(GENERATED_MARK)) return null;
	if (!CLASS_KW.test(code)) return null;
	const body = parse_body(code, id_n);
	if (!body) return null;
	const classes = exportedWireClassesFromBody(body, code, id_n);
	if (classes.length === 0) return null;

	const rel = path.relative(root, id_n).split('\\').join('/');
	return `${code + registrationBlock(rel, classes)}\n`;
}

function registrationBlock(rel: string, classes: WireExport[]): string {
	const lines = [
		'',
		GENERATED_MARK,
		`import { __register_transportable as __OGT } from 'ogygia/internal/register';`
	];
	for (const { tag, local } of classes)
		lines.push(`__OGT(${JSON.stringify(`${rel}#${tag}`)}, ${local});`);
	return lines.join('\n');
}

function moduleScriptOf(code: string): { body: string; injectAt: number } | null {
	const mod = component_blocks(code).find((b) => b.kind === 'script' && b.module);
	return mod ? { body: code.slice(mod.start, mod.end), injectAt: mod.end } : null;
}

/** True if a `.svelte` file's `<script module>` exports a transportable class. */
export function svelteModuleHasTransportable(code: string, id_n: string): boolean {
	if (!code.includes('module') || !CLASS_KW.test(code)) return false;
	const mod = moduleScriptOf(code);
	if (!mod) return false;
	return moduleHasTransportable(mod.body, id_n.replace(SVELTE_EXT, '.svelte.ts'));
}

/** Inject registration for a `.svelte` module script's exported transportable classes. */
export function appendSvelteModuleRegistrations(
	code: string,
	id_n: string,
	root: string
): string | null {
	const edit = svelte_module_registration(code, id_n, root);
	return edit ? splice_text(code, [edit]) : null;
}

/** The insert `appendSvelteModuleRegistrations` makes to `code`, or `null` when it makes none. */
export function svelte_module_registration(code: string, id_n: string, root: string): Edit | null {
	if (code.includes(GENERATED_MARK) || !CLASS_KW.test(code)) return null;
	const mod = moduleScriptOf(code);
	if (!mod) return null;
	const exported = exportedWireClasses(mod.body, id_n.replace(SVELTE_EXT, '.svelte.ts'));
	if (exported.length === 0) return null;
	const rel = path.relative(root, id_n).split('\\').join('/');
	return {
		start: mod.injectAt,
		end: mod.injectAt,
		text: `\n${registrationBlock(rel, exported)}\n`
	};
}
