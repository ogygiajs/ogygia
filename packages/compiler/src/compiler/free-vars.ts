import { walk } from 'estree-walker';
import type { SvelteNode } from './region/ir.ts';

/**
 * Free-variable analysis over a Svelte 5 template subtree.
 *
 * Given an array of top-level template nodes (a hoisted island subtree), returns
 * the set of identifier names that are referenced inside the subtree but bound
 * OUTSIDE it (host `<script>` vars, outer `{#each}` locals, component imports,
 * globals...), PLUS the set of those free names that are the TARGET of a mutation
 * (assignment / update / compound-assign / destructuring-assignment / `bind:`).
 * Identifiers bound *within* the subtree (snippet params, each locals, `{@const}`,
 * `{#await}` value/error, `let:` directives, and JS-level function params) are
 * excluded from both sets.
 *
 * The mutation set powers a build-time guard: captured host state crosses the
 * boundary as a serialized SNAPSHOT, so writing to it inside an island updates
 * nothing. The transform turns a mutated capture into a precise error.
 */

// static: the AST node types that open a function scope
const FUNCTION_TYPES = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression'
]);

// static: the loops whose head may declare a block-scoped name
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement']);

// Minimal estree shape for the function-scope handling (no @types/estree dependency).
interface EsFunction {
	id?: { name: string } | null;
	params: SvelteNode[];
}
/** The estree node `estree-walker` walks (its own type, without depending on @types/estree). */
type WalkNode = Parameters<typeof walk>[0];

/** Accumulators threaded through the whole analysis. */
interface Sink {
	/** free references (reads) */
	refs: Set<string>;
	/** free names written to (assignment / update / bind target root) */
	mutated: Set<string>;
	/**
	 * Free `$`-prefixed references (store auto-subscriptions like `$country`, plus the
	 * `$$props` family), with every occurrence's source offsets. The sugar is host-scoped:
	 * emitted verbatim into a synth entry it names an out-of-scope `$`-identifier, which
	 * runes mode rejects — the transform captures the subscription VALUE and rewrites these
	 * exact spans to the capture's prop name instead.
	 */
	stores: Map<string, Array<{ start: number; end: number }>>;
}

/** Collect bound names from an estree binding pattern (never the names its defaults read). */
export function collect_pattern_names(node: SvelteNode | null | undefined, out: Set<string>): void {
	if (!node) return;
	switch (node.type) {
		case 'Identifier':
			out.add(node.name);
			break;
		case 'ObjectPattern':
			for (const prop of node.properties) {
				if (prop.type === 'RestElement') collect_pattern_names(prop.argument, out);
				else collect_pattern_names(prop.value, out);
			}
			break;
		case 'ArrayPattern':
			for (const el of node.elements) collect_pattern_names(el, out);
			break;
		case 'AssignmentPattern':
			collect_pattern_names(node.left, out);
			break;
		case 'RestElement':
			collect_pattern_names(node.argument, out);
			break;
	}
}

/** The leftmost identifier name of a member chain (`a.b.c` -> `a`), or null. */
function member_root(node: SvelteNode): string | null {
	let cur = node;
	while (cur && cur.type === 'MemberExpression') cur = cur.object;
	return cur && cur.type === 'Identifier' ? cur.name : null;
}

/**
 * Collect the ROOT identifier names written by an assignment/update target — an
 * Identifier (`x = …`), a MemberExpression (`x.a = …` -> `x`), or a destructuring
 * pattern (`[x] = …`, `({ x } = …)`, defaults, rests, nested member targets).
 */
function collect_write_roots(target: SvelteNode, roots: Set<string>) {
	if (!target) return;
	switch (target.type) {
		case 'Identifier':
			roots.add(target.name);
			break;
		case 'MemberExpression': {
			const r = member_root(target);
			if (r) roots.add(r);
			break;
		}
		case 'ObjectPattern':
			for (const prop of target.properties) {
				if (prop.type === 'RestElement') collect_write_roots(prop.argument, roots);
				else collect_write_roots(prop.value, roots);
			}
			break;
		case 'ArrayPattern':
			for (const el of target.elements) if (el) collect_write_roots(el, roots);
			break;
		case 'AssignmentPattern':
			collect_write_roots(target.left, roots);
			break;
		case 'RestElement':
			collect_write_roots(target.argument, roots);
			break;
	}
}

/** Is this Identifier node a *reference* (a read) rather than a binding/property name? */
function is_reference(
	node: SvelteNode,
	parent: SvelteNode | null,
	key: string | number | symbol | null | undefined
) {
	if (!parent) return true;
	switch (parent.type) {
		// obj.prop -> `prop` is not a reference (unless computed)
		case 'MemberExpression':
			if (key === 'property' && !parent.computed) return false;
			return true;
		// { prop: value } -> `prop` key is not a reference (unless computed/shorthand handled below)
		case 'Property':
			if (key === 'key' && !parent.computed) {
				// shorthand { x } -> key === value === same node, still a reference read
				return parent.shorthand;
			}
			return true;
		// binding ids are not references
		case 'VariableDeclarator':
			return key !== 'id';
		case 'FunctionDeclaration':
		case 'FunctionExpression':
		case 'ArrowFunctionExpression':
			return key !== 'id' && key !== 'params';
		case 'ClassDeclaration':
		case 'ClassExpression':
			return key !== 'id';
		// a class member's name: `m() {}`, `x = 1` (unless computed)
		case 'MethodDefinition':
		case 'PropertyDefinition':
			return key !== 'key' || parent.computed;
		case 'ImportSpecifier':
		case 'ImportDefaultSpecifier':
		case 'ImportNamespaceSpecifier':
			return false;
		case 'LabeledStatement':
		case 'BreakStatement':
		case 'ContinueStatement':
			return key !== 'label';
		case 'CatchClause':
			return key !== 'param';
		// `import.meta`: no names, a meta property
		case 'MetaProperty':
			return false;
		default:
			// a TS type position (`x: T`, `<T>`) names no value; `x as T` / `x!` still read `x`
			return !parent.type.startsWith('TS') || key === 'expression';
	}
}

/**
 * Walk one estree expression, adding any free references (not bound by inner
 * JS function scopes and not in `svelte_bound`) into `sink.refs`, and any free
 * assignment/update targets into `sink.mutated`.
 */
function add_expression_refs(expr: SvelteNode, svelte_bound: Set<string>, sink: Sink) {
	if (!expr) return;
	const scopes: Set<string>[] = [new Set()];
	const has = (name: string) => {
		if (svelte_bound.has(name)) return true;
		for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return true;
		return false;
	};
	const record_writes = (target: SvelteNode) => {
		const roots = new Set<string>();
		collect_write_roots(target, roots);
		for (const r of roots) if (!has(r)) sink.mutated.add(r);
	};
	walk(expr as WalkNode, {
		enter(node, parent, key) {
			if (opens_scope(node, parent)) {
				// every name the scope binds, before any is read (a function declared below its call,
				// a `var` in a nested block)
				scopes.push(scope_bindings(node));
			} else if (node.type === 'ClassDeclaration') {
				// binds its name where it stands (a class EXPRESSION's name is bound only inside it)
				const id = (node as { id?: { name: string } | null }).id;
				if (id) scopes[scopes.length - 1].add(id.name);
			} else if (node.type === 'VariableDeclarator') {
				collect_pattern_names(node.id, scopes[scopes.length - 1]);
			} else if (node.type === 'AssignmentExpression') {
				record_writes(node.left);
			} else if (node.type === 'UpdateExpression') {
				record_writes(node.argument);
			} else if (node.type === 'Identifier' && is_reference(node, parent, key)) {
				if (!has(node.name)) {
					sink.refs.add(node.name);
					// (Svelte's parse carries offsets on every node; estree's type does not declare them)
					const at = node as typeof node & { start?: number; end?: number };
					if (node.name.startsWith('$') && at.start != null && at.end != null) {
						let sites = sink.stores.get(node.name);
						if (!sites) sink.stores.set(node.name, (sites = []));
						sites.push({ start: at.start, end: at.end });
					}
				}
			}
		},
		leave(node, parent) {
			if (opens_scope(node, parent)) scopes.pop();
		}
	});
}

/** The names `stmts` declare for their own block: `let` / `const`, classes, functions, imports. */
function lexical_names(stmts: SvelteNode[] | undefined, out: Set<string>) {
	for (const stmt of stmts ?? []) {
		const s =
			stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration'
				? (stmt.declaration ?? stmt)
				: stmt;
		if (s.type === 'VariableDeclaration' && s.kind !== 'var')
			for (const d of s.declarations) collect_pattern_names(d.id, out);
		else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id)
			out.add(s.id.name);
		else if (s.type === 'ImportDeclaration')
			for (const sp of s.specifiers ?? []) if (sp.local?.name) out.add(sp.local.name);
	}
}

/** Every `var` under `node`, through blocks but never into a nested function: they bind to it. */
function var_names(node: SvelteNode | null | undefined, out: Set<string>) {
	if (!node) return;
	// a `var` stands only where a statement does, so only statements are entered
	switch (node.type) {
		case 'VariableDeclaration':
			if (node.kind === 'var') for (const d of node.declarations) collect_pattern_names(d.id, out);
			break;
		case 'Program':
		case 'BlockStatement':
		case 'StaticBlock':
			for (const s of node.body) var_names(s, out);
			break;
		case 'ExportNamedDeclaration':
			var_names(node.declaration, out);
			break;
		case 'IfStatement':
			var_names(node.consequent, out);
			var_names(node.alternate, out);
			break;
		case 'ForStatement':
			var_names(node.init, out);
			var_names(node.body, out);
			break;
		case 'ForInStatement':
		case 'ForOfStatement':
			var_names(node.left, out);
			var_names(node.body, out);
			break;
		case 'WhileStatement':
		case 'DoWhileStatement':
		case 'LabeledStatement':
		case 'WithStatement':
			var_names(node.body, out);
			break;
		case 'TryStatement':
			var_names(node.block, out);
			var_names(node.handler?.body, out);
			var_names(node.finalizer, out);
			break;
		case 'SwitchStatement':
			for (const c of node.cases) for (const s of c.consequent) var_names(s, out);
			break;
	}
}

/** Does `node` open a scope of its own (a function's body block shares the function's)? */
function opens_scope(node: { type: string }, parent: { type: string } | null): boolean {
	if (!SCOPE_TYPES.has(node.type)) return false;
	return node.type !== 'BlockStatement' || !FUNCTION_TYPES.has(parent?.type ?? '');
}

// static: the AST node types that may open a scope (a block only when it is no function's body)
const SCOPE_TYPES = new Set([
	...FUNCTION_TYPES,
	...LOOP_TYPES,
	'CatchClause',
	'SwitchStatement',
	'Program',
	'BlockStatement'
]);

/**
 * The names a scope binds for its whole extent, hoisting included: a function its parameters, its
 * own name and every `var`, `let`, `const`, class and function its body declares; a block, a
 * `switch` or a program what it declares (a program also its imports and `var`s); a loop its head's
 * declarations; a catch clause its parameter (test/og-dollar.test.ts, test/free-vars-patterns.test.ts).
 */
export function scope_bindings(node: SvelteNode): Set<string> {
	const out = new Set<string>();
	if (FUNCTION_TYPES.has(node.type)) {
		const fn = node as EsFunction & { body?: SvelteNode };
		if (fn.id) out.add(fn.id.name);
		for (const p of fn.params) collect_pattern_names(p, out);
		if (fn.body?.type === 'BlockStatement') {
			lexical_names(fn.body.body, out);
			var_names(fn.body, out);
		}
	} else if (node.type === 'BlockStatement') lexical_names(node.body, out);
	else if (node.type === 'Program') {
		lexical_names(node.body, out);
		var_names(node, out);
	} else if (node.type === 'SwitchStatement')
		for (const c of node.cases ?? []) lexical_names(c.consequent, out);
	else if (node.type === 'CatchClause') collect_pattern_names(node.param, out);
	else if (LOOP_TYPES.has(node.type)) {
		const head = node.type === 'ForStatement' ? node.init : node.left;
		if (head?.type === 'VariableDeclaration')
			for (const d of head.declarations) collect_pattern_names(d.id, out);
	}
	return out;
}

/** The names `expr` reads from outside itself, in source order: what a hoisted closure must be
 *  handed (`import.meta.og.$`'s captures). */
export function free_references(expr: SvelteNode): string[] {
	const sink: Sink = { refs: new Set(), mutated: new Set(), stores: new Map() };
	add_expression_refs(expr, new Set(), sink);
	return [...sink.refs];
}

/** A template binder's pattern (`{#each … as p}`, a snippet parameter, `{@const p = …}`): its names
 *  are bound, and its defaults and computed keys are READ, in `bound` (test/free-vars-patterns.test.ts). */
function add_pattern_refs(pattern: SvelteNode | null | undefined, bound: Set<string>, sink: Sink) {
	if (!pattern) return;
	switch (pattern.type) {
		case 'AssignmentPattern':
			add_expression_refs(pattern.right, bound, sink);
			add_pattern_refs(pattern.left, bound, sink);
			break;
		case 'ObjectPattern':
			for (const prop of pattern.properties) {
				if (prop.type === 'RestElement') add_pattern_refs(prop.argument, bound, sink);
				else {
					if (prop.computed) add_expression_refs(prop.key, bound, sink);
					add_pattern_refs(prop.value, bound, sink);
				}
			}
			break;
		case 'ArrayPattern':
			for (const el of pattern.elements) add_pattern_refs(el, bound, sink);
			break;
		case 'RestElement':
			add_pattern_refs(pattern.argument, bound, sink);
			break;
	}
}

/** Names introduced by `let:` directives on an element/component. */
function let_directive_names(node: SvelteNode): Set<string> {
	const names = new Set<string>();
	for (const attr of node.attributes ?? []) {
		if (attr.type === 'LetDirective') {
			if (attr.expression) collect_pattern_names(attr.expression, names);
			else names.add(attr.name);
		}
	}
	return names;
}

/** Walk attribute expressions of an element/component (not `let:`, which binds). */
function add_attribute_refs(node: SvelteNode, bound: Set<string>, sink: Sink) {
	/** An attribute's value: `true` (no value), text with `{…}` parts, or one `{…}`. */
	const add_value_refs = (value: SvelteNode) => {
		if (Array.isArray(value)) {
			for (const part of value) {
				if (part.type === 'ExpressionTag') add_expression_refs(part.expression, bound, sink);
			}
		} else if (value?.type === 'ExpressionTag') {
			// single-expression attribute: `a={x}` or shorthand `{x}`
			add_expression_refs(value.expression, bound, sink);
		}
	};
	/** A name the template reads as a variable (`use:act`, `style:color`); its root for `a.b`. */
	const add_name_ref = (name: string) => {
		const root = name.split('.')[0];
		if (root && !bound.has(root)) sink.refs.add(root);
	};
	for (const attr of node.attributes ?? []) {
		switch (attr.type) {
			case 'Attribute':
				if (attr.value !== true) add_value_refs(attr.value); // `true`: a boolean attribute
				break;
			case 'StyleDirective':
				// `style:color` alone reads `color`; with a value, the value is read
				if (attr.value === true) add_name_ref(attr.name);
				else add_value_refs(attr.value);
				break;
			case 'UseDirective':
			case 'TransitionDirective':
			case 'AnimateDirective':
				// `use:act={arg}` / `transition:fade` / `animate:flip`: the function itself, then its argument
				add_name_ref(attr.name);
				if (attr.expression) add_expression_refs(attr.expression, bound, sink);
				break;
			case 'SpreadAttribute':
				add_expression_refs(attr.expression, bound, sink);
				break;
			case 'LetDirective':
				add_pattern_refs(attr.expression, bound, sink); // binds; reads only its defaults
				break;
			case 'BindDirective':
				// `bind:value={target}` READS and WRITES `target`. Record the write-root so a
				// `bind:` into a captured host snapshot is caught (it would update nothing).
				if (attr.expression) {
					add_expression_refs(attr.expression, bound, sink);
					const root =
						attr.expression.type === 'Identifier'
							? attr.expression.name
							: member_root(attr.expression);
					if (root && !bound.has(root)) sink.mutated.add(root);
				}
				break;
			default:
				// On/Class/Style/Transition/Animate/Use/In/Out directives
				if (attr.expression) add_expression_refs(attr.expression, bound, sink);
		}
	}
}

/** Collect snippet names + const-declared names defined at this fragment level. */
function sibling_bindings(nodes: SvelteNode[]) {
	const names = new Set<string>();
	for (const n of nodes) {
		if (n.type === 'SnippetBlock' && n.expression) names.add(n.expression.name);
		else if (n.type === 'ConstTag') {
			for (const d of n.declaration.declarations) collect_pattern_names(d.id, names);
		}
	}
	return names;
}

function fragment_nodes(fragment: SvelteNode): SvelteNode[] {
	return fragment?.nodes ?? [];
}

/**
 * @param nodes top-level nodes of the subtree
 * @param outer_bound names bound outside (usually empty at entry)
 * @param sink accumulates free references + mutations
 */
function walk_template(nodes: SvelteNode[], outer_bound: Set<string>, sink: Sink) {
	const bound = new Set(outer_bound);
	for (const name of sibling_bindings(nodes)) bound.add(name);

	for (const node of nodes) {
		switch (node.type) {
			case 'Text':
			case 'Comment':
				break;
			case 'ExpressionTag':
			case 'HtmlTag':
			case 'RenderTag':
				add_expression_refs(node.expression, bound, sink);
				break;
			case 'ConstTag':
				for (const d of node.declaration.declarations) {
					add_pattern_refs(d.id, bound, sink);
					add_expression_refs(d.init, bound, sink);
				}
				break;
			case 'DebugTag':
				for (const id of node.identifiers ?? []) add_expression_refs(id, bound, sink);
				break;
			case 'IfBlock':
				add_expression_refs(node.test, bound, sink);
				walk_template(fragment_nodes(node.consequent), bound, sink);
				if (node.alternate) walk_template(fragment_nodes(node.alternate), bound, sink);
				break;
			case 'EachBlock': {
				add_expression_refs(node.expression, bound, sink);
				const each_bound = new Set(bound);
				collect_pattern_names(node.context, each_bound);
				if (node.index) each_bound.add(node.index);
				add_pattern_refs(node.context, each_bound, sink);
				if (node.key) add_expression_refs(node.key, each_bound, sink);
				walk_template(fragment_nodes(node.body), each_bound, sink);
				if (node.fallback) walk_template(fragment_nodes(node.fallback), bound, sink);
				break;
			}
			case 'AwaitBlock': {
				add_expression_refs(node.expression, bound, sink);
				if (node.pending) walk_template(fragment_nodes(node.pending), bound, sink);
				if (node.then) {
					const then_bound = new Set(bound);
					if (node.value) collect_pattern_names(node.value, then_bound);
					add_pattern_refs(node.value, then_bound, sink);
					walk_template(fragment_nodes(node.then), then_bound, sink);
				}
				if (node.catch) {
					const catch_bound = new Set(bound);
					if (node.error) collect_pattern_names(node.error, catch_bound);
					add_pattern_refs(node.error, catch_bound, sink);
					walk_template(fragment_nodes(node.catch), catch_bound, sink);
				}
				break;
			}
			case 'KeyBlock':
				add_expression_refs(node.expression, bound, sink);
				walk_template(fragment_nodes(node.fragment), bound, sink);
				break;
			case 'SnippetBlock': {
				const snip_bound = new Set(bound);
				for (const p of node.parameters ?? []) collect_pattern_names(p, snip_bound);
				for (const p of node.parameters ?? []) add_pattern_refs(p, snip_bound, sink);
				walk_template(fragment_nodes(node.body), snip_bound, sink);
				break;
			}
			case 'Component':
			case 'SvelteComponent': {
				// the component: its name (`Foo` / `Foo.Bar`), or `<svelte:component this={…}>`'s expression
				if (node.type === 'SvelteComponent') add_expression_refs(node.expression, bound, sink);
				else {
					const root = String(node.name || '').split('.')[0];
					if (root && !bound.has(root)) sink.refs.add(root);
				}
				add_attribute_refs(node, bound, sink);
				const el_bound1 = new Set(bound);
				for (const name of let_directive_names(node)) el_bound1.add(name);
				if (node.fragment) walk_template(fragment_nodes(node.fragment), el_bound1, sink);
				break;
			}
			case 'RegularElement':
			case 'SvelteElement':
			case 'SvelteSelf':
			case 'SvelteFragment':
			case 'SvelteBoundary':
			case 'SlotElement':
			case 'TitleElement': {
				if (node.tag) add_expression_refs(node.tag, bound, sink); // <svelte:element this={tag}>
				add_attribute_refs(node, bound, sink);
				const el_bound = new Set(bound);
				for (const name of let_directive_names(node)) el_bound.add(name);
				if (node.fragment) walk_template(fragment_nodes(node.fragment), el_bound, sink);
				break;
			}
			default:
				if (node.fragment) walk_template(fragment_nodes(node.fragment), bound, sink);
		}
	}
}

/** Collect all snippet names defined anywhere in a subtree (for cross-boundary error detection). */
export function collectSnippetNames(nodes: SvelteNode[]): Set<unknown> {
	const out = new Set();
	const visit = (list: SvelteNode[]) => {
		for (const n of list ?? []) {
			if (n.type === 'SnippetBlock' && n.expression) out.add(n.expression.name);
			for (const k of [
				'consequent',
				'alternate',
				'body',
				'fallback',
				'pending',
				'then',
				'catch',
				'fragment'
			]) {
				if (n[k]?.nodes) visit(n[k].nodes);
			}
		}
	};
	visit(nodes);
	return out;
}

/**
 * @param nodes hoisted subtree top-level nodes
 * @returns free identifier names + free mutation targets + `$store` read sites
 */
export function collectCaptureInfo(nodes: SvelteNode[]): {
	free: Set<string>;
	mutated: Set<string>;
	stores: Map<string, { start: number; end: number }[]>;
} {
	const sink: Sink = { refs: new Set(), mutated: new Set(), stores: new Map() };
	walk_template(nodes, new Set(), sink);
	return { free: sink.refs, mutated: sink.mutated, stores: sink.stores };
}

/**
 * @param nodes hoisted subtree top-level nodes
 * @returns free identifier names
 */
export function collectFreeIdentifiers(nodes: SvelteNode[]): Set<string> {
	return collectCaptureInfo(nodes).free;
}
