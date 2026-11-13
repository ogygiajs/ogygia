import { parse_roots } from './page-keys.ts';
import { OWN_PACKAGE_NAMES, key_name } from '@ogygia/core/contract';
import type { AstNode } from '../parse/oxc.ts';

type SvelteNode = AstNode;

const CTX_MODULES: ReadonlySet<string> = new Set(['svelte', ...OWN_PACKAGE_NAMES]);
const NODE_SKIP: ReadonlySet<string> = new Set([
	'start',
	'end',
	'loc',
	'range',
	'parent',
	'metadata',
	'leadingComments',
	'trailingComments',
	'__parent',
	'__key'
]);

function name_of(n: SvelteNode | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Identifier') return n.name ?? null;
	if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
	return null;
}

function literal_string(n: SvelteNode | undefined): string | null {
	return n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : null;
}

type KeyExpr = { name: string } | { one_off: true } | null;

function symbol_key(n: SvelteNode | undefined): KeyExpr {
	if (n?.type !== 'CallExpression') return null;
	const callee = n.callee;
	if (callee?.type === 'Identifier' && callee.name === 'Symbol') return { one_off: true };
	if (
		callee?.type === 'MemberExpression' &&
		!callee.computed &&
		callee.object?.type === 'Identifier' &&
		callee.object.name === 'Symbol' &&
		name_of(callee.property) === 'for'
	) {
		const shared = literal_string(n.arguments?.[0]);
		return shared === null ? null : { name: key_name(Symbol.for(shared)) ?? '' };
	}
	return null;
}

function key_expr(n: SvelteNode | undefined, consts: Map<string, KeyExpr>): KeyExpr {
	const s = literal_string(n);
	if (s !== null) return { name: key_name(s) ?? s };
	if (n?.type === 'Identifier') return consts.get(n.name) ?? null;
	return symbol_key(n);
}

/** The context keys a file READS via getContext and SETS via setContext, each by the name it crosses
 *  under (`key_name`), and the one-off `Symbol()` keys ogygia's own setContext is handed (as written).
 *  Each call is PROVEN, by following the import binding rather than matching text, to be
 *  Svelte/ogygia's. */
export interface ContextKeys {
	reads: string[];
	sets: string[];
	one_off: string[];
}

/**
 * Resolve the keys a file reads via `getContext(…)` and sets via `setContext(…)` (a string literal, a
 * `Symbol.for('…')`, or a module-level const bound to one), where each call is PROVEN — by following
 * the import binding, not by matching text — to be Svelte's or ogygia's. Counts a `getContext as gc`
 * alias and a namespace `ns.getContext(…)`; ignores a local function of the same name, a
 * `foo.getContext(…)` on an unrelated object, and a dynamic key.
 *
 * `one_off` names each one-off `Symbol()` key handed to ogygia's own `setContext` with no options
 * (`{ islands: false }` keeps a key off the page on purpose): it cannot cross.
 *
 * `reads` drives the WARNING: on a csr=false page the page/layout `<script>` never runs on the client,
 * so a value set with Svelte's own `setContext` in a page/layout is gone by the time an island hydrates
 * in isolation — the island reads `undefined`, renders a different tree, and Svelte discards its server
 * DOM (a silent full re-render). `sets` is what makes the warning precise: a key an island's OWN code
 * both sets and reads lives inside one hydration root (a component library using context internally) and
 * needs no bridge — the caller subtracts island sets from island reads so only a key provided OUTSIDE
 * the island is flagged. Empty on a file with no such call, or one that cannot be parsed.
 */
export function context_keys(src: string, kind: 'svelte' | 'script'): ContextKeys {
	const none: ContextKeys = { reads: [], sets: [], one_off: [] };
	const wants_get = src.includes('getContext');
	const wants_set = src.includes('setContext');
	if (!wants_get && !wants_set) return none;
	const roots = parse_roots(src, 'ogygia:context-detect', kind);
	if (!roots) return none;

	const get_locals = new Set<string>();
	const set_locals = new Set<string>();
	const own_set_locals = new Set<string>();
	const namespaces = new Set<string>();
	const own_namespaces = new Set<string>();
	const consts = new Map<string, KeyExpr>();
	for (const root of roots) {
		if (root.type !== 'Program') continue;
		for (const decl of root.body ?? []) {
			if (decl.type !== 'VariableDeclaration' || decl.kind !== 'const') continue;
			for (const d of decl.declarations ?? []) {
				const key = d.id?.type === 'Identifier' ? symbol_key(d.init) : null;
				if (key) consts.set(d.id.name, key);
			}
		}
	}
	const calls: SvelteNode[] = [];
	const walk = (node: SvelteNode | null | undefined): void => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const c of node) walk(c as SvelteNode);
			return;
		}
		if (node.type === 'ImportDeclaration' && CTX_MODULES.has(String(node.source?.value ?? ''))) {
			const own = OWN_PACKAGE_NAMES.includes(String(node.source?.value));
			for (const s of node.specifiers ?? []) {
				if (s.type === 'ImportSpecifier' && s.local?.name) {
					const imported = name_of(s.imported);
					if (imported === 'getContext') get_locals.add(s.local.name);
					else if (imported === 'setContext') {
						set_locals.add(s.local.name);
						if (own) own_set_locals.add(s.local.name);
					}
				} else if (s.type === 'ImportNamespaceSpecifier' && s.local?.name) {
					namespaces.add(s.local.name);
					if (own) own_namespaces.add(s.local.name);
				}
			}
		} else if (node.type === 'CallExpression') {
			calls.push(node);
		}
		for (const k in node) {
			if (NODE_SKIP.has(k)) continue;
			const v = (node as Record<string, unknown>)[k];
			if (v && typeof v === 'object') walk(v as SvelteNode);
		}
	};
	for (const root of roots) walk(root);
	if (get_locals.size === 0 && set_locals.size === 0 && namespaces.size === 0) return none;

	const reads = new Set<string>();
	const sets = new Set<string>();
	const one_off: string[] = [];
	for (const call of calls) {
		const arg = call.arguments?.[0];
		const key = key_expr(arg, consts);
		if (key === null) continue;
		const callee = call.callee;
		let op: 'get' | 'set' | 'own_set' | null = null;
		if (callee?.type === 'Identifier') {
			if (get_locals.has(callee.name)) op = 'get';
			else if (set_locals.has(callee.name))
				op = own_set_locals.has(callee.name) ? 'own_set' : 'set';
		} else if (
			callee?.type === 'MemberExpression' &&
			!callee.computed &&
			callee.object?.type === 'Identifier' &&
			namespaces.has(callee.object.name)
		) {
			const member = name_of(callee.property);
			if (member === 'getContext') op = 'get';
			else if (member === 'setContext')
				op = own_namespaces.has(callee.object.name) ? 'own_set' : 'set';
		}
		if (op === null) continue;
		if ('name' in key) (op === 'get' ? reads : sets).add(key.name);
		else if (op === 'own_set' && (call.arguments?.length ?? 0) < 3)
			one_off.push(src.slice(arg.start, arg.end));
	}
	return { reads: [...reads], sets: [...sets], one_off };
}
