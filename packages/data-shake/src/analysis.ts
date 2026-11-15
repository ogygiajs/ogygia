import fs from 'node:fs';
import { parse_roots, type AstNode } from '@ogygia/compiler';

type Node = AstNode;

export type PageKeys = ReadonlySet<string> | 'all';

const PAGE_SPECIFIER_RE = /^\$app\/(?:state|stores)$/;
const SAFE_FIELDS: ReadonlySet<string> = new Set([
	'url',
	'params',
	'route',
	'status',
	'error',
	'form',
	'state'
]);
const SKIP_KEYS: ReadonlySet<string> = new Set([
	'start',
	'end',
	'loc',
	'range',
	'parent',
	'metadata',
	'leadingComments',
	'trailingComments'
]);
const PAGE_SPECIFIER_HINT_RE = /\$app\/st(?:ate|ores)/;
const WHOLE_USE: ReadonlyMap<string, string> = new Map([
	['VariableDeclarator', '`page.data` is aliased whole (`const d = page.data`)'],
	['SpreadElement', '`page.data` is spread'],
	['ReturnStatement', '`page.data` is returned whole'],
	['ArrowFunctionExpression', '`page.data` is returned whole']
]);
const FLIP_SIDE: Readonly<Record<'server' | 'client', 'server' | 'client'>> = {
	server: 'client',
	client: 'server'
};

class All extends Error {
	readonly why: string;
	readonly at: number | null;

	constructor(why: string, at: number | null) {
		super(why);
		this.why = why;
		this.at = at;
	}
}

/** `'all'` with its reason: which construct, at which line. */
export type AllReason = { why: string; line: number | null };

/**
 * A call that hands the page to an IMPORTED helper: `getParams(page)`. The module alone cannot say
 * what the helper reads; the build resolves the specifier, summarizes the helper's export
 * ({@link summarize_export}) and folds the answer in — one level deep. A CMS app passed the page
 * to one `url`-reading helper from 149 modules; following the call pins all of them.
 */
export type PendingCall = { specifier: string; imported: string; arg: number; line: number | null };

export type PageKeysAnswer = {
	keys: PageKeys | null;
	reason: AllReason | null;
	pending: PendingCall[];
};

/**
 * The top-level `page.data` keys a module reads, or `'all'` when a read cannot be pinned to a
 * literal key, or `null` when the module never imports the page (nothing to ship for it).
 * `kind` picks the parser: `'svelte'` for a component source, `'script'` for `.ts` / `.js`.
 */
export function page_data_keys(
	code: string,
	id: string,
	kind: 'svelte' | 'script'
): PageKeys | null {
	return page_data_keys_answer(code, id, kind).keys;
}

/** The same answer with the reason an `'all'` was given (for the build report). */
export function page_data_keys_answer(
	code: string,
	id: string,
	kind: 'svelte' | 'script'
): PageKeysAnswer {
	if (!PAGE_SPECIFIER_HINT_RE.test(code)) return { keys: null, reason: null, pending: [] };
	const roots = parse_roots(code, id, kind);
	if (!roots)
		return {
			keys: 'all',
			reason: { why: 'the module did not parse here (the bundler will say why)', line: null },
			pending: []
		};
	const scan = new Scan(code);
	try {
		for (const root of roots) scan.collect_bindings(root);
		if (!scan.refs.size) return { keys: null, reason: null, pending: [] };
		let grew = true;
		while (grew) grew = roots.map((root) => scan.grow(root)).some(Boolean);
		for (const root of roots) scan.walk(root, null, null);
		return { keys: scan.keys, reason: null, pending: scan.pending };
	} catch (e) {
		if (e instanceof All)
			return {
				keys: 'all',
				reason: { why: e.why, line: e.at === null ? null : line_of(code, e.at) },
				pending: []
			};
		throw e;
	}
}

/**
 * What an exported helper reads of a page handed to it as its `arg`-th parameter — the bundle-time
 * half of following `helper(page)`. `'all'` when the export is not a plain function (a re-export,
 * a class, a variable the analysis cannot follow), when the parameter is not a plain name, or when
 * the helper itself hands the page on (one level only).
 */
export type ExportSummary = PageKeys | { follow: string[]; imported: string };

export function summarize_export(
	code: string,
	id: string,
	kind: 'svelte' | 'script',
	name: string,
	arg: number
): ExportSummary {
	const roots = parse_roots(code, id, kind);
	if (!roots) return 'all';
	let fn: Node | null = null;
	let named_follow: string | null = null;
	const stars: string[] = [];
	let imported = name;
	let fn_name: string | null = null;
	const local_fns = new Map<string, Node>();
	const imports = new Map<string, { specifier: string; imported: string }>();
	for (const root of roots) {
		visit(root, (node) => {
			if (node.type === 'FunctionDeclaration' && node.id?.name && !enclosing_scope(node))
				local_fns.set(node.id.name, node);
			if (
				node.type === 'VariableDeclarator' &&
				node.id?.type === 'Identifier' &&
				node.init &&
				(node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') &&
				!enclosing_scope(node)
			)
				local_fns.set(node.id.name, node.init);
			if (node.type === 'ImportDeclaration')
				for (const s of node.specifiers ?? [])
					if (s.type === 'ImportSpecifier')
						imports.set(s.local.name, {
							specifier: String(node.source?.value ?? ''),
							imported: spec_name(s.imported) ?? s.local.name
						});
			if (node.type === 'ExportAllDeclaration' && node.source)
				stars.push(String(node.source.value));
			if (node.type !== 'ExportNamedDeclaration') return;
			for (const s of node.specifiers ?? []) {
				if (spec_name(s.exported) !== name) continue;
				const local = spec_name(s.local) ?? name;
				if (node.source) {
					named_follow = String(node.source.value);
					imported = local;
				} else if (local_fns.has(local)) {
					fn = local_fns.get(local)!;
					fn_name = local;
				} else if (imports.has(local)) {
					named_follow = imports.get(local)!.specifier;
					imported = imports.get(local)!.imported;
				}
			}
			const d = node.declaration;
			if (!d) return;
			if (d.type === 'FunctionDeclaration' && d.id?.name === name) {
				fn = d;
				fn_name = name;
			}
			if (d.type === 'VariableDeclaration') {
				for (const v of d.declarations ?? []) {
					if (
						v.id?.type === 'Identifier' &&
						v.id.name === name &&
						v.init &&
						(v.init.type === 'ArrowFunctionExpression' || v.init.type === 'FunctionExpression')
					) {
						fn = v.init;
						fn_name = name;
					}
				}
			}
		});
		if (fn) {
			const rebound = fn_name;
			if (rebound !== null && roots.some((r) => assigned_names(r).has(rebound))) return 'all';
			break;
		}
	}
	if (!fn) {
		if (named_follow) return { follow: [named_follow], imported };
		return stars.length ? { follow: stars, imported } : 'all';
	}
	const param = (fn as Node).params?.[arg];
	if (!param || param.type !== 'Identifier') return 'all';
	const scan = new Scan(code);
	for (const [local, imp] of imports) scan.import_binding(local, imp.specifier, imp.imported);
	try {
		scan.seed_param(param.name, fn as Node);
		scan.grow(fn as Node);
		scan.walk((fn as Node).params, fn, 'params');
		scan.walk((fn as Node).body, fn, 'body');
		if (scan.pending.length) return 'all';
		return scan.keys;
	} catch (e) {
		if (e instanceof All) return 'all';
		throw e;
	}
}

function line_of(code: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < code.length; i++) if (code.charCodeAt(i) === 10) line++;
	return line;
}

const WRAPPERS: ReadonlySet<string> = new Set([
	'TSAsExpression',
	'TSNonNullExpression',
	'TSSatisfiesExpression',
	'TSTypeAssertion',
	'ParenthesizedExpression',
	'ChainExpression'
]);
function unwrap_up(node: Node): { node: Node; parent: Node | null; key: string | null } {
	let cur = node;
	let parent = cur.__parent as Node | null;
	let key = cur.__key as string | null;
	while (parent && WRAPPERS.has(parent.type) && key === 'expression') {
		cur = parent;
		parent = cur.__parent as Node | null;
		key = cur.__key as string | null;
	}
	return { node: cur, parent, key };
}

/** Union two answers: `'all'` absorbs everything, `null` is the identity. */
export function merge_page_keys(a: PageKeys | null, b: PageKeys | null): PageKeys | null {
	if (a === 'all' || b === 'all') return 'all';
	if (!a) return b;
	if (!b) return a;
	return new Set([...a, ...b]);
}

/** Does this module even mention a page-store specifier? (the transform's pre-filter) */
export function mentions_page_store(code: string): boolean {
	return PAGE_SPECIFIER_HINT_RE.test(code);
}

const SCOPE_TYPES: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
	'ClassMethod',
	'MethodDefinition',
	'PropertyDefinition',
	'Program',
	'Fragment',
	'Root'
]);

class Scan {
	readonly refs = new Set<string>();
	readonly #scopes = new Map<string, Set<Node | null>>();
	readonly keys = new Set<string>();
	readonly pending: PendingCall[] = [];
	readonly #imports = new Map<string, { specifier: string; imported: string }>();
	readonly #store = new Map<string, 'get' | 'derived'>();
	readonly #local_fns = new Map<string, Node>();
	readonly #followed = new Set<Node>();
	readonly #assigned = new Set<string>();

	private readonly code: string;

	constructor(code: string) {
		this.code = code;
	}

	seed_param(name: string, fn: Node): void {
		this.#add_ref(name, fn.body ?? fn);
		const scopes = this.#scopes.get(name)!;
		scopes.add(fn);
		this.#followed.add(fn);
	}

	#add_ref(name: string, at: Node | null): boolean {
		const scope = at ? enclosing_scope(at) : null;
		let scopes = this.#scopes.get(name);
		if (!scopes) this.#scopes.set(name, (scopes = new Set()));
		if (scopes.has(scope)) return false;
		scopes.add(scope);
		this.refs.add(name);
		return true;
	}

	import_binding(local: string, specifier: string, imported: string): void {
		this.#imports.set(local, { specifier, imported });
		if (specifier === 'svelte/store' && (imported === 'get' || imported === 'derived'))
			this.#store.set(local, imported);
	}

	#local_fn(callee: Node): Node | undefined {
		const fn = this.#local_fns.get(callee.name);
		return fn && !declared_above(callee.name, callee, false) ? fn : undefined;
	}

	#store_helper(callee: Node): 'get' | 'derived' | undefined {
		const helper = this.#store.get(callee.name);
		return helper && !declared_above(callee.name, callee, false) ? helper : undefined;
	}

	#in_followed(node: Node): boolean {
		for (let n: Node | null = node; n; n = n.__parent as Node | null)
			if (this.#followed.has(n)) return true;
		return false;
	}

	#in_scope(name: string, use: Node): boolean {
		const scopes = this.#scopes.get(name);
		if (!scopes) return false;
		if (scopes.has(null)) return true;
		for (let n: Node | null = use; n; n = n.__parent as Node | null) if (scopes.has(n)) return true;
		return false;
	}

	collect_bindings(root: Node): void {
		visit(root, (node) => {
			if (node.type === 'FunctionDeclaration' && node.id?.name && !enclosing_scope(node))
				this.#local_fns.set(node.id.name, node);
			if (
				node.type === 'VariableDeclarator' &&
				node.id?.type === 'Identifier' &&
				node.init &&
				(node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression') &&
				!enclosing_scope(node)
			)
				this.#local_fns.set(node.id.name, node.init);
			if (
				(node.type === 'ExportAllDeclaration' ||
					(node.type === 'ExportNamedDeclaration' &&
						node.specifiers?.some((s: Node) => spec_name(s.local) === 'page'))) &&
				PAGE_SPECIFIER_RE.test(String(node.source?.value ?? ''))
			)
				throw new All('the page store is re-exported', node.start ?? null);
			if (
				node.type === 'ImportExpression' &&
				PAGE_SPECIFIER_RE.test(static_string(node.source) ?? '')
			)
				throw new All('the page store is imported with `import()`', node.start ?? null);
			if (node.type !== 'ImportDeclaration') return;
			const specifier = String(node.source?.value ?? '');
			for (const s of node.specifiers ?? []) {
				if (s.type === 'ImportSpecifier')
					this.import_binding(s.local.name, specifier, spec_name(s.imported) ?? s.local.name);
				else if (s.type === 'ImportDefaultSpecifier')
					this.import_binding(s.local.name, specifier, 'default');
			}
			if (!PAGE_SPECIFIER_RE.test(specifier)) return;
			for (const s of node.specifiers ?? []) {
				if (s.type === 'ImportNamespaceSpecifier' || s.type === 'ImportDefaultSpecifier')
					throw new All('the page store is imported as a namespace', s.start ?? null);
				if (s.type === 'ImportSpecifier' && spec_name(s.imported) === 'getStores')
					throw new All('the page store is taken from `getStores()`', s.start ?? null);
				if (s.type === 'ImportSpecifier' && spec_name(s.imported) === 'page')
					this.#add_ref(s.local.name, null);
			}
		});
		for (const name of assigned_names(root)) this.#assigned.add(name);
		for (const name of this.#assigned) this.#local_fns.delete(name);
	}

	grow(root: Node): boolean {
		let any = false;
		let grew = true;
		while (grew) {
			grew = false;
			visit(root, (node) => {
				if (
					node.type === 'VariableDeclarator' &&
					node.init &&
					this.is_page_value(unwrap_down(node.init))
				) {
					if (node.id?.type === 'Identifier') {
						if (this.#add_ref(node.id.name, node)) grew = true;
					} else {
						throw new All('the page is destructured (`const { data } = page`)', node.start ?? null);
					}
				}
				if (node.type === 'CallExpression') {
					const callee = node.callee;
					const args = node.arguments ?? [];
					const local = callee?.type === 'Identifier' ? this.#local_fn(callee) : undefined;
					if (local) {
						const fn = local;
						args.forEach((a: Node, i: number) => {
							if (!this.is_page_value(a)) return;
							const p = fn.params?.[i];
							if (p?.type === 'Identifier') {
								if (this.#add_ref(p.name, fn.body ?? fn)) grew = true;
								this.#scopes.get(p.name)!.add(fn);
								this.#followed.add(fn);
							}
						});
					}
					if (
						callee?.type === 'MemberExpression' &&
						!callee.computed &&
						callee.property?.name === 'subscribe' &&
						this.is_page_value(callee.object)
					) {
						const fn = args[0];
						const p = fn?.params?.[0];
						if (fn && p?.type === 'Identifier' && this.#add_ref(p.name, fn.body ?? fn)) {
							this.#scopes.get(p.name)!.add(fn);
							grew = true;
						}
					}
					if (
						callee?.type === 'Identifier' &&
						this.#store_helper(callee) === 'derived' &&
						args.length >= 2
					) {
						const fn = args[1];
						const param = fn?.params?.[0];
						if (args[0]?.type === 'Identifier' && this.is_page_value(args[0])) {
							if (param?.type === 'Identifier') {
								if (this.#add_ref(param.name, fn)) grew = true;
							} else if (param)
								throw new All(
									'a derived() over the page destructures its parameter',
									param.start ?? null
								);
						} else if (args[0]?.type === 'ArrayExpression') {
							args[0].elements.forEach((el: Node, i: number) => {
								if (el?.type !== 'Identifier' || !this.is_page_value(el)) return;
								const p = param?.type === 'ArrayPattern' ? param.elements[i] : null;
								if (p?.type === 'Identifier') {
									if (this.#add_ref(p.name, fn)) grew = true;
								} else
									throw new All(
										'a derived([…, page, …]) does not name the page parameter',
										(p ?? el).start ?? null
									);
							});
						}
					}
				}
			});
			if (grew) any = true;
		}
		return any;
	}

	is_page_value(raw: Node): boolean {
		const n = unwrap_down(raw);
		if (n.type === 'Identifier') {
			const bare = n.name.startsWith('$') ? n.name.slice(1) : n.name;
			return this.#in_scope(n.name, n) || (bare !== n.name && this.#in_scope(bare, n));
		}
		if (
			n.type === 'CallExpression' &&
			n.callee?.type === 'Identifier' &&
			this.#store_helper(n.callee) === 'get'
		) {
			const a = n.arguments?.[0];
			return !!a && a.type === 'Identifier' && this.#in_scope(a.name, a);
		}
		return false;
	}

	walk(node: Node, parent: Node | null, key: string | null): void {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) this.walk(child, parent, key);
			return;
		}
		if (node.type === 'Identifier' && node.name === 'arguments' && this.#in_followed(node))
			throw new All('a function handed the page reads `arguments`', node.start ?? null);
		if (
			typeof node.type === 'string' &&
			this.is_page_value(node) &&
			!is_declaration(node, parent, key)
		) {
			this.judge(node, parent, key);
			if (node.type === 'CallExpression') return;
		}
		if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') {
			const side = runs_on(node.test);
			if (side) {
				this.walk(node.test, node, 'test');
				if (side !== 'server') this.walk(node.consequent, node, 'consequent');
				if (side !== 'client' && node.alternate) this.walk(node.alternate, node, 'alternate');
				return;
			}
		}
		if (
			node.type === 'LogicalExpression' &&
			node.operator === '&&' &&
			runs_on(node.left) === 'server'
		) {
			this.walk(node.left, node, 'left');
			return;
		}
		for (const k of Object.keys(node)) {
			if (SKIP_KEYS.has(k)) continue;
			const v = node[k];
			if (v && typeof v === 'object') this.walk(v, node, k);
		}
	}

	judge(value: Node, raw_parent: Node | null, raw_key: string | null): void {
		const {
			node: v,
			parent,
			key
		} = raw_parent && WRAPPERS.has(raw_parent.type)
			? unwrap_up(value)
			: { node: value, parent: raw_parent, key: raw_key };
		const at = value.start ?? null;
		if (!parent) throw new All('the page is used bare', at);
		if (parent.type === 'MemberExpression' && key === 'object') {
			const field = member_name(parent);
			if (field === 'data') {
				this.judge_data(parent);
				return;
			}
			if (field !== null && SAFE_FIELDS.has(field)) return;
			if (field === 'subscribe') {
				const call = parent.__parent as Node | null;
				const fn =
					call?.type === 'CallExpression' && (parent.__key as string) === 'callee'
						? call.arguments?.[0]
						: null;
				if (
					fn &&
					(fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression') &&
					fn.params?.[0]?.type === 'Identifier'
				)
					return;
				throw new All('`page.subscribe(…)` hands a subscriber the whole page', at);
			}
			throw new All(
				field === null ? 'the page is indexed with an expression' : `\`page.${field}\` is read`,
				at
			);
		}
		if (parent.type === 'VariableDeclarator' && key === 'init') return;
		if (
			parent.type === 'CallExpression' &&
			key === 'arguments' &&
			parent.callee?.type === 'Identifier'
		) {
			const name = parent.callee.name;
			const helper = this.#store_helper(parent.callee);
			if (helper === 'get') return;
			if (helper === 'derived') {
				const cb = parent.arguments[1];
				if (
					parent.arguments[0] === v &&
					(cb?.type === 'ArrowFunctionExpression' || cb?.type === 'FunctionExpression') &&
					cb.params?.[0]?.type === 'Identifier'
				)
					return;
				throw new All('`derived(page, …)` hands the page to a callback it does not read here', at);
			}
			const fn = this.#local_fn(parent.callee);
			if (fn) {
				const i = parent.arguments.indexOf(v);
				if (fn.params?.[i]?.type === 'Identifier') return;
				throw new All(
					`the whole page is passed to \`${name}(…)\`, whose parameter is destructured`,
					at
				);
			}
			const imp = declared_above(name, parent.callee, false) ? undefined : this.#imports.get(name);
			if (imp) {
				this.pending.push({
					specifier: imp.specifier,
					imported: imp.imported,
					arg: parent.arguments.indexOf(v),
					line: at === null ? null : line_of(this.code, at)
				});
				return;
			}
			throw new All(`the whole page is passed to \`${name}(…)\``, at);
		}
		if (parent.type === 'ArrayExpression') {
			const call = parent.__parent as Node | null;
			if (
				call?.type === 'CallExpression' &&
				call.callee?.type === 'Identifier' &&
				this.#store_helper(call.callee) === 'derived' &&
				call.arguments?.[0] === parent &&
				call.arguments.length >= 2
			)
				return;
			throw new All('the whole page is put in an array', at);
		}
		if (
			parent.type === 'CallExpression' &&
			key === 'arguments' &&
			parent.callee?.type === 'MemberExpression' &&
			parent.callee.object?.name === 'Object' &&
			parent.callee.property?.name === 'keys'
		)
			return;
		throw new All('the whole page escapes (passed on, returned, spread, exported or compared)', at);
	}

	judge_data(data_member: Node): void {
		let { parent: owner, key: owner_key } = unwrap_up(data_member);
		const at = data_member.start ?? null;
		while (
			owner &&
			owner.type === 'LogicalExpression' &&
			(owner.operator === '||' || owner.operator === '??') &&
			owner_key === 'left'
		) {
			const up = unwrap_up(owner);
			owner = up.parent;
			owner_key = up.key;
		}
		if (!owner) throw new All('`page.data` is used bare', at);
		if (owner.type === 'MemberExpression' && owner_key === 'object') {
			const k = member_name(owner);
			if (k === null) throw new All('`page.data[…]` is indexed with an expression', at);
			const call = unwrap_up(owner);
			if (call.parent?.type === 'CallExpression' && call.key === 'callee')
				throw new All(`\`page.data.${k}(…)\` is called with \`page.data\` as \`this\``, at);
			this.keys.add(k);
			return;
		}
		if (
			owner.type === 'VariableDeclarator' &&
			owner_key === 'init' &&
			owner.id?.type === 'ObjectPattern'
		) {
			for (const p of owner.id.properties) {
				if (p.type !== 'Property' || p.computed)
					throw new All('`page.data` is destructured with a rest or computed key', p.start ?? at);
				let k: string | null = null;
				if (p.key?.type === 'Identifier') k = p.key.name;
				else if (p.key?.type === 'Literal') k = String(p.key.value);
				if (k === null)
					throw new All('`page.data` is destructured with a non-literal key', p.start ?? at);
				this.keys.add(k);
			}
			return;
		}
		if (owner.type === 'CallExpression')
			throw new All(`\`page.data\` is handed whole to ${call_name(owner)}(…)`, at);
		throw new All(WHOLE_USE.get(owner.type) ?? `\`page.data\` is used whole (${owner.type})`, at);
	}
}

function runs_on(test: Node | null | undefined): 'server' | 'client' | null {
	const t = test ? unwrap_down(test) : null;
	if (!t) return null;
	if (t.type === 'UnaryExpression' && t.operator === '!') {
		const inner = runs_on(t.argument);
		return inner && FLIP_SIDE[inner];
	}
	if (
		t.type === 'MemberExpression' &&
		!t.computed &&
		t.property?.name === 'SSR' &&
		t.object?.type === 'MemberExpression' &&
		t.object.property?.name === 'env' &&
		t.object.object?.type === 'MetaProperty'
	)
		return 'server';
	if (t.type !== 'BinaryExpression') return null;
	const eq = t.operator === '===' || t.operator === '==';
	if (!eq && t.operator !== '!==' && t.operator !== '!=') return null;
	const typeof_global = (n: Node) =>
		n?.type === 'UnaryExpression' &&
		n.operator === 'typeof' &&
		n.argument?.type === 'Identifier' &&
		(n.argument.name === 'window' || n.argument.name === 'document') &&
		!declared_above(n.argument.name, n.argument, true);
	const undef = (n: Node) =>
		(n?.type === 'Literal' || n?.type === 'StringLiteral') && n.value === 'undefined';
	const l = unwrap_down(t.left);
	const r = unwrap_down(t.right);
	if (!((typeof_global(l) && undef(r)) || (typeof_global(r) && undef(l)))) return null;
	return eq ? 'server' : 'client';
}

function declared_above(name: string, use: Node, module: boolean): boolean {
	for (let n = use.__parent as Node | null; n; n = n.__parent as Node | null) {
		if ((n.type === 'Program' || n.type === 'Fragment' || n.type === 'Root') && !module)
			return false;
		if (declares(n, name)) return true;
	}
	return false;
}

function declares(n: Node, name: string): boolean {
	const has = (pattern: Node | null | undefined) => pattern_names(pattern).includes(name);
	switch (n.type) {
		case 'FunctionDeclaration':
		case 'FunctionExpression':
		case 'ArrowFunctionExpression':
			return (n.params ?? []).some(has) || (n.type === 'FunctionExpression' && n.id?.name === name);
		case 'Program':
		case 'BlockStatement':
		case 'StaticBlock':
			return (n.body ?? []).some((s: Node) => statement_declares(s, name));
		case 'ForStatement':
			return n.init?.type === 'VariableDeclaration' && statement_declares(n.init, name);
		case 'ForInStatement':
		case 'ForOfStatement':
			return n.left?.type === 'VariableDeclaration' && statement_declares(n.left, name);
		case 'CatchClause':
			return has(n.param);
		case 'SnippetBlock':
			return (n.parameters ?? []).some(has);
		case 'EachBlock':
			return has(n.context) || n.index === name;
		default:
			return false;
	}
}

function statement_declares(s: Node, name: string): boolean {
	const d =
		s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration'
			? s.declaration
			: s;
	if (!d) return false;
	if (d.type === 'VariableDeclaration')
		return (d.declarations ?? []).some((x: Node) => pattern_names(x.id).includes(name));
	if (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') return d.id?.name === name;
	if (d.type === 'ImportDeclaration')
		return (d.specifiers ?? []).some((x: Node) => x.local?.name === name);
	return false;
}

function pattern_names(p: Node | null | undefined): string[] {
	if (!p) return [];
	if (p.type === 'Identifier') return [p.name];
	if (p.type === 'ObjectPattern')
		return (p.properties ?? []).flatMap((x: Node) =>
			pattern_names(x.type === 'RestElement' ? x.argument : x.value)
		);
	if (p.type === 'ArrayPattern') return (p.elements ?? []).flatMap((x: Node) => pattern_names(x));
	if (p.type === 'RestElement') return pattern_names(p.argument);
	if (p.type === 'AssignmentPattern') return pattern_names(p.left);
	if (WRAPPERS.has(p.type)) return pattern_names(p.expression);
	return [];
}

function enclosing_scope(node: Node): Node | null {
	for (let n = node.__parent as Node | null; n; n = n.__parent as Node | null) {
		if (SCOPE_TYPES.has(n.type))
			return n.type === 'Program' || n.type === 'Fragment' || n.type === 'Root' ? null : n;
	}
	return null;
}

function unwrap_down(n: Node): Node {
	let cur = n;
	while (cur && WRAPPERS.has(cur.type) && cur.expression) cur = cur.expression;
	return cur;
}

function call_name(call: Node): string {
	const c = call.callee;
	if (!c) return '?';
	if (c.type === 'Identifier') return c.name;
	if (c.type === 'MemberExpression') return `${c.object?.name ?? '…'}.${c.property?.name ?? '…'}`;
	return '?';
}

function member_name(m: Node): string | null {
	if (!m.computed) return m.property?.type === 'Identifier' ? m.property.name : null;
	return static_string(m.property);
}

function static_string(n: Node | null | undefined): string | null {
	if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
	if (n?.type === 'TemplateLiteral' && n.expressions?.length === 0)
		return n.quasis?.[0]?.value?.cooked ?? null;
	return null;
}

function spec_name(n: Node | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Identifier') return n.name;
	if (n.type === 'Literal') return String(n.value);
	return null;
}

function is_declaration(node: Node, parent: Node | null, key: string | null): boolean {
	if (!parent || node.type !== 'Identifier') return false;
	if (parent.type === 'VariableDeclarator' && key === 'id') return true;
	if (parent.type === 'Property' && key === 'key' && !parent.computed) return true;
	if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return true;
	if (
		parent.type === 'ImportSpecifier' ||
		parent.type === 'ImportDefaultSpecifier' ||
		parent.type === 'ImportNamespaceSpecifier'
	)
		return true;
	if (key === 'params') return true;
	if (
		parent.type === 'ArrayPattern' ||
		parent.type === 'ObjectPattern' ||
		parent.type === 'RestElement'
	)
		return true;
	if (parent.type === 'AssignmentPattern') return key === 'left';
	if (
		(parent.type === 'FunctionDeclaration' ||
			parent.type === 'FunctionExpression' ||
			parent.type === 'ClassDeclaration') &&
		key === 'id'
	)
		return true;
	if (parent.type === 'LabeledStatement' && key === 'label') return true;
	return false;
}

function assigned_names(root: Node): Set<string> {
	const names = new Set<string>();
	const target = (t: Node | null | undefined): void => {
		if (!t) return;
		if (t.type === 'Identifier') names.add(t.name);
		else if (t.type === 'ObjectPattern')
			for (const p of t.properties ?? []) target(p.type === 'RestElement' ? p.argument : p.value);
		else if (t.type === 'ArrayPattern') for (const e of t.elements ?? []) target(e);
		else if (t.type === 'RestElement') target(t.argument);
		else if (t.type === 'AssignmentPattern') target(t.left);
		else if (WRAPPERS.has(t.type)) target(t.expression);
	};
	const rec = (node: Node): void => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) rec(child);
			return;
		}
		if (node.type === 'AssignmentExpression') target(node.left);
		else if (node.type === 'UpdateExpression') target(node.argument);
		for (const k of Object.keys(node)) {
			if (SKIP_KEYS.has(k)) continue;
			const v = node[k];
			if (v && typeof v === 'object') rec(v);
		}
	};
	rec(root);
	return names;
}

function visit(root: Node, fn: (node: Node) => void): void {
	const rec = (node: Node, parent: Node | null, key: string | null) => {
		if (!node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) rec(child, parent, key);
			return;
		}
		if (typeof node.type === 'string') {
			Object.defineProperty(node, '__parent', {
				value: parent,
				enumerable: false,
				configurable: true
			});
			Object.defineProperty(node, '__key', { value: key, enumerable: false, configurable: true });
			fn(node);
		}
		for (const k of Object.keys(node)) {
			if (SKIP_KEYS.has(k)) continue;
			const v = node[k];
			if (v && typeof v === 'object') rec(v, node, k);
		}
	};
	rec(root, null, null);
}

const FOLLOW_MAX_HOPS = 4;
const SVELTE_EXT_RE = /\.svelte$/;
const SCRIPT_EXT_RE = /\.(?:[cm]?[jt]sx?)$/;

export type PendingResolver = (
	specifier: string,
	importer: string
) => Promise<{ id: string } | null | undefined>;

/**
 * For every module with pending `helper(page)` calls: resolve each helper, summarize its export,
 * fold the answer into the module's keys (`'all'` with a reason when the helper cannot be
 * summarized). Runs once per build, before the closure union. `read` and `resolve` are the
 * build's (fs + the bundler's resolver), threaded in so this stays testable.
 */
export async function follow_pending_page_calls(
	program: {
		page_keys: Map<string, PageKeys>;
		page_key_reasons: Map<string, AllReason>;
		page_pending: Map<string, PendingCall[]>;
	},
	resolve: PendingResolver,
	read: (file: string) => string | null = read_file_sync
): Promise<void> {
	const summaries = new Map<string, PageKeys>();
	for (const [module, calls] of program.page_pending) {
		let keys: PageKeys | null = program.page_keys.get(module) ?? new Set();
		for (const call of calls) {
			if (keys === 'all') break;
			const answer = await summarize_call(call, module, resolve, read, summaries);
			if (answer.keys === 'all') {
				keys = 'all';
				program.page_key_reasons.set(module, {
					why: `the whole page is passed to \`${call.imported}(…)\` — ${answer.why}`,
					line: call.line
				});
				break;
			}
			keys = merge_page_keys(keys, answer.keys) ?? keys;
		}
		program.page_keys.set(module, keys ?? new Set());
	}
	program.page_pending.clear();
}

async function summarize_call(
	call: PendingCall,
	importer: string,
	resolve: PendingResolver,
	read: (file: string) => string | null,
	memo: Map<string, PageKeys>
): Promise<{ keys: PageKeys; why: string }> {
	let specifier = call.specifier;
	let from = importer;
	let name = call.imported;
	for (let hop = 0; hop < FOLLOW_MAX_HOPS; hop++) {
		let resolved: { id: string } | null | undefined;
		try {
			resolved = await resolve(specifier, from);
			// oxlint-disable-next-line ogygia/no-silent-failures -- unresolved answers 'all' just below, with the reason in the build report
		} catch {
			resolved = null;
		}
		if (!resolved?.id)
			return { keys: 'all', why: `\`${specifier}\` could not be resolved from the caller` };
		const file = resolved.id.split('?')[0];
		const memo_key = `${file}#${name}#${call.arg}`;
		const hit = memo.get(memo_key);
		if (hit) return { keys: hit, why: '' };
		let kind: 'svelte' | 'script' | null = null;
		if (SVELTE_EXT_RE.test(file)) kind = 'svelte';
		else if (SCRIPT_EXT_RE.test(file)) kind = 'script';
		const code = kind ? read(file) : null;
		if (!kind || code === null)
			return { keys: 'all', why: `the helper's module (${file}) could not be read` };
		const summary = summarize_export(code, file, kind, name, call.arg);
		if (summary === 'all')
			return {
				keys: 'all',
				why: `\`${name}\` in ${file} hands the page on, or is not a plain function`
			};
		if (!is_reexport(summary)) {
			memo.set(memo_key, summary);
			return { keys: summary, why: '' };
		}
		if (summary.follow.length === 1) {
			specifier = summary.follow[0];
			from = file;
			name = summary.imported;
			continue;
		}
		for (const source of summary.follow) {
			const sub = await summarize_call(
				{ ...call, specifier: source, imported: summary.imported },
				file,
				resolve,
				read,
				memo
			);
			if (sub.keys !== 'all') return sub;
		}
		return { keys: 'all', why: `\`${name}\` was not found behind the \`export *\` of ${file}` };
	}
	return { keys: 'all', why: `\`${name}\` sits behind more than ${FOLLOW_MAX_HOPS} re-exports` };
}

function is_reexport(s: ExportSummary): s is { follow: string[]; imported: string } {
	return typeof s === 'object' && s !== null && 'follow' in s;
}

export function read_file_sync(file: string): string | null {
	try {
		return fs.readFileSync(file, 'utf8');
		// oxlint-disable-next-line ogygia/no-silent-failures -- an unreadable helper answers 'all' in summarize_call, with the reason
	} catch {
		return null;
	}
}
