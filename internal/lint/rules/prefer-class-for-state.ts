import { ALL_SOURCE, type Context, type Node } from './shared.ts';

const OUT_OF_SCOPE =
	/(^|\/)(test|tests|__tests__|fixtures?|e2e)\/|\.(test|spec)\.[cm]?[jt]s$|\.d\.ts$/;
const FUNCTIONS: ReadonlySet<string> = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression'
]);
const COLLECTIONS: ReadonlySet<string> = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'Array']);
const MUTATORS: ReadonlySet<string> = new Set([
	'set',
	'add',
	'delete',
	'clear',
	'push',
	'pop',
	'shift',
	'unshift',
	'splice',
	'sort',
	'reverse',
	'fill',
	'copyWithin'
]);
const RUNES: ReadonlySet<string> = new Set(['$state', '$derived']);
const SKIPPED_KEYS: ReadonlySet<string> = new Set(['parent', 'loc', 'range', 'type']);

const MESSAGE_CLOSURE =
	'State kept in a closure with functions over it: make it a class and export the class (callers write `new X(…)`; no factory wrapper for internal code).';
const message_module = (names: string[]): string =>
	`Module state (${names.join(', ')}) written by two or more functions: group the state and its functions into a class and export the class (no factory wrapper for internal code).`;

const name_of = (n: unknown): string | undefined =>
	(n as Node | undefined)?.type === 'Identifier' ? (n as { name: string }).name : undefined;

function bare(e: Node | null | undefined): Node | null | undefined {
	while (
		e?.type === 'ParenthesizedExpression' ||
		e?.type === 'TSAsExpression' ||
		e?.type === 'TSSatisfiesExpression' ||
		e?.type === 'TSNonNullExpression'
	)
		e = e.expression as Node;
	return e;
}

function children(n: Node): Node[] {
	const out: Node[] = [];
	for (const key in n) {
		if (SKIPPED_KEYS.has(key)) continue;
		const v = n[key];
		if (Array.isArray(v)) {
			for (const x of v) if (x && typeof (x as Node).type === 'string') out.push(x as Node);
		} else if (v && typeof (v as Node).type === 'string') out.push(v as Node);
	}
	return out;
}

function pattern_names(p: Node | null | undefined, into: Set<string>): void {
	if (!p) return;
	switch (p.type) {
		case 'Identifier':
			into.add((p as { name: string }).name);
			return;
		case 'ObjectPattern':
			for (const prop of p.properties as Node[])
				pattern_names((prop.type === 'RestElement' ? prop.argument : prop.value) as Node, into);
			return;
		case 'ArrayPattern':
			for (const el of p.elements as (Node | null)[]) pattern_names(el, into);
			return;
		case 'RestElement':
			pattern_names(p.argument as Node, into);
			return;
		case 'AssignmentPattern':
			pattern_names(p.left as Node, into);
			return;
		case 'TSParameterProperty':
			pattern_names(p.parameter as Node, into);
	}
}

function declared_in(fn: Node): Set<string> {
	const names = new Set<string>();
	for (const p of fn.params as Node[]) pattern_names(p, names);
	const visit = (n: Node): void => {
		if (n.type === 'VariableDeclaration')
			for (const d of n.declarations as Node[]) pattern_names(d.id as Node, names);
		else if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') {
			const id = name_of(n.id);
			if (id !== undefined) names.add(id);
		}
		if (FUNCTIONS.has(n.type) || n.type === 'ClassDeclaration') return;
		for (const c of children(n)) visit(c);
	};
	const body = fn.body as Node;
	if (body.type === 'BlockStatement') for (const c of children(body)) visit(c);
	return names;
}

const root_name = (e: Node | undefined): string | undefined => {
	let n = bare(e);
	while (n?.type === 'MemberExpression') n = bare(n.object as Node);
	return name_of(n);
};

function written_names(n: Node, mutations: boolean): string[] {
	const out = new Set<string>();
	if (n.type === 'AssignmentExpression') {
		const left = n.left as Node;
		if (left.type === 'MemberExpression') {
			if (mutations) {
				const r = root_name(left);
				if (r !== undefined) out.add(r);
			}
		} else pattern_names(left, out);
	} else if (n.type === 'UpdateExpression') {
		const arg = bare(n.argument as Node) as Node;
		if (arg.type === 'Identifier') out.add((arg as { name: string }).name);
		else if (mutations) {
			const r = root_name(arg);
			if (r !== undefined) out.add(r);
		}
	} else if (mutations && n.type === 'CallExpression') {
		const callee = bare(n.callee as Node);
		if (callee?.type === 'MemberExpression' && !callee.computed) {
			const method = name_of(callee.property);
			const r = name_of(bare(callee.object as Node));
			if (method !== undefined && MUTATORS.has(method) && r !== undefined) out.add(r);
		}
	} else if (mutations && n.type === 'UnaryExpression' && n.operator === 'delete') {
		const r = root_name(n.argument as Node);
		if (r !== undefined) out.add(r);
	}
	return [...out];
}

function writes_in_functions(
	root: Node,
	tracked: ReadonlySet<string>,
	mutations: boolean,
	in_fn: boolean,
	found: Set<string>
): void {
	const visit = (n: Node, inside: boolean, hidden: ReadonlySet<string>): void => {
		let hide = hidden;
		let now = inside;
		if (FUNCTIONS.has(n.type)) {
			now = true;
			const own = [...declared_in(n)].filter((x) => tracked.has(x));
			if (own.length) hide = new Set([...hidden, ...own]);
		}
		if (now)
			for (const name of written_names(n, mutations))
				if (tracked.has(name) && !hide.has(name)) found.add(name);
		for (const c of children(n)) visit(c, now, hide);
	};
	visit(root, in_fn, new Set());
}

function is_rune(init: Node | null | undefined): boolean {
	const e = bare(init);
	if (e?.type !== 'CallExpression') return false;
	const callee = e.callee as Node;
	const head = callee.type === 'MemberExpression' ? (callee.object as Node) : callee;
	const name = name_of(head);
	return name !== undefined && RUNES.has(name);
}

function is_collection(init: Node | null | undefined): boolean {
	const e = bare(init);
	if (e?.type === 'ArrayExpression') return true;
	if (e?.type !== 'NewExpression') return false;
	const name = name_of(e.callee);
	return name !== undefined && COLLECTIONS.has(name);
}

function is_function(e: Node | null | undefined): boolean {
	const n = bare(e);
	return n !== null && n !== undefined && FUNCTIONS.has(n.type);
}

function returns_of(fn: Node): Node[] {
	const out: Node[] = [];
	const visit = (n: Node): void => {
		if (n.type === 'ReturnStatement' && n.argument) out.push(n.argument as Node);
		if (FUNCTIONS.has(n.type) || n.type === 'ClassDeclaration' || n.type === 'ClassExpression')
			return;
		for (const c of children(n)) visit(c);
	};
	for (const c of children(fn.body as Node)) visit(c);
	return out;
}

function hands_out_functions(object: Node, inner: ReadonlySet<string>): boolean {
	let has_function = false;
	for (const p of object.properties as Node[]) {
		if (p.type !== 'Property') continue;
		const key = name_of(p.key) ?? (p.key as { value?: unknown }).value;
		if (key === 'name' && !p.computed) return false;
		const value = bare(p.value as Node);
		if (p.kind === 'get' || p.kind === 'set' || p.method === true || is_function(value))
			has_function = true;
		else if (value?.type === 'Identifier' && inner.has((value as { name: string }).name))
			has_function = true;
	}
	return has_function;
}

function closure_class(fn: Node): boolean {
	const body = fn.body as Node;
	if (body.type !== 'BlockStatement') return false;
	const state = new Set<string>();
	const inner = new Set<string>();
	const objects = new Map<string, Node>();
	for (const s of body.body as Node[]) {
		if (s.type === 'FunctionDeclaration') {
			const id = name_of(s.id);
			if (id !== undefined) inner.add(id);
			continue;
		}
		if (s.type !== 'VariableDeclaration') continue;
		for (const d of s.declarations as Node[]) {
			const id = name_of(d.id);
			if (id === undefined) continue;
			const init = d.init as Node | null;
			if (is_function(init)) inner.add(id);
			else if (bare(init)?.type === 'ObjectExpression') objects.set(id, bare(init) as Node);
			if (is_rune(init)) continue;
			if (s.kind === 'let' || is_collection(init)) state.add(id);
		}
	}
	if (!state.size) return false;
	const handed = returns_of(fn).some((r) => {
		const e = bare(r);
		const object =
			e?.type === 'ObjectExpression'
				? e
				: e?.type === 'Identifier'
					? objects.get((e as { name: string }).name)
					: undefined;
		return object !== undefined && hands_out_functions(object, inner);
	});
	if (!handed) return false;
	const found = new Set<string>();
	writes_in_functions(body, state, true, false, found);
	return found.size > 0;
}

const SIDE_TABLES: ReadonlySet<string> = new Set(['WeakMap', 'WeakSet']);

function side_table(init: Node | null | undefined): boolean {
	const e = bare(init);
	const name = e?.type === 'NewExpression' ? name_of(e.callee) : undefined;
	return name !== undefined && SIDE_TABLES.has(name);
}

const start_of = (n: Node): number => (n as { range: [number, number] }).range[0];

const READONLY_TYPES: ReadonlySet<string> = new Set([
	'ReadonlyMap',
	'ReadonlySet',
	'ReadonlyArray',
	'Readonly'
]);

function is_readonly_type(t: Node | null | undefined): boolean {
	if (!t) return false;
	if (t.type === 'TSTypeOperator') return t.operator === 'readonly';
	if (t.type === 'TSTypeReference') {
		const name = name_of(t.typeName);
		return name !== undefined && READONLY_TYPES.has(name);
	}
	return false;
}

function readonly_table(d: Node): boolean {
	const annotation = (d.id as { typeAnnotation?: { typeAnnotation?: Node } }).typeAnnotation;
	if (is_readonly_type(annotation?.typeAnnotation)) return true;
	let e = d.init as Node | null | undefined;
	while (e?.type === 'TSAsExpression' || e?.type === 'TSSatisfiesExpression') {
		const t = e.typeAnnotation as Node;
		if (is_readonly_type(t)) return true;
		if (t.type === 'TSTypeReference' && name_of(t.typeName) === 'const') return true;
		e = e.expression as Node;
	}
	return false;
}

function module_state(program: Node): { lets: Map<string, Node>; tables: Map<string, Node> } {
	const lets = new Map<string, Node>();
	const tables = new Map<string, Node>();
	for (const s of program.body as Node[]) {
		const decl = s.type === 'ExportNamedDeclaration' ? (s.declaration as Node | null) : s;
		if (decl?.type !== 'VariableDeclaration') continue;
		for (const d of decl.declarations as Node[]) {
			const init = d.init as Node | null;
			if (is_rune(init)) continue;
			if (decl.kind === 'let') {
				const names = new Set<string>();
				pattern_names(d.id as Node, names);
				for (const name of names) lets.set(name, d);
			} else if (is_collection(init) && !side_table(init) && !readonly_table(d)) {
				const id = name_of(d.id);
				if (id !== undefined) tables.set(id, d);
			}
		}
	}
	return { lets, tables };
}

function units(program: Node): Node[] {
	const out: Node[] = [];
	for (const s of program.body as Node[]) {
		const decl =
			s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration'
				? ((s.declaration as Node | null) ?? s)
				: s;
		if (decl.type === 'VariableDeclaration') out.push(...(decl.declarations as Node[]));
		else out.push(decl);
	}
	return out;
}

function shared_lets(program: Node): { names: string[]; at: Node } | null {
	const { lets, tables } = module_state(program);
	if (!lets.size && !tables.size) return null;
	const writers = new Map<string, number>();
	for (const unit of units(program)) {
		const found = new Set<string>();
		writes_in_functions(unit, lets, false, false, found);
		writes_in_functions(unit, tables, true, false, found);
		for (const name of found) writers.set(name, (writers.get(name) ?? 0) + 1);
	}
	const declared = new Map([...lets, ...tables]);
	const names = [...declared.keys()].filter((n) => (writers.get(n) ?? 0) >= 2);
	if (!names.length) return null;
	const at = names
		.map((n) => declared.get(n)!)
		.reduce((a, b) => (start_of(a) <= start_of(b) ? a : b));
	return { names, at };
}

export const prefer_class_for_state = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'State and the functions around it are a class, exported as the class: not a closure handing out an object of functions, nor module lets several functions write.'
		}
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		const source = ALL_SOURCE.exec(file);
		if (!source || OUT_OF_SCOPE.test(file.slice(source.index + source[0].length))) return {};
		const check = (node: Node) => {
			if (closure_class(node)) context.report({ node, message: MESSAGE_CLOSURE });
		};
		return {
			FunctionDeclaration: check,
			FunctionExpression: check,
			ArrowFunctionExpression: check,
			Program(program: Node) {
				if (file.endsWith('.svelte')) return;
				const shared = shared_lets(program);
				if (shared) context.report({ node: shared.at, message: message_module(shared.names) });
			}
		};
	}
};
