/**
 * The repo's own lint rules (an oxlint JS plugin, `.oxlintrc.json` → `jsPlugins`). They hold the
 * 0.13 rules for package source (`packages/<pkg>/src`), outside `@ogygia/machine` itself, which is
 * where the primitives they point at live:
 *
 * - `ogygia/compiler-boundary`: `@ogygia/compiler` uses core only through `@ogygia/core/contract`,
 *   and core never uses the compiler (#488, #513).
 * - `ogygia/no-promise-cache`: async work that callers share is a `flights()` (one flight per key,
 *   a success kept, a failure never kept, work stopped when its last caller leaves). A `Map` or
 *   `WeakMap` of promises, or a `??=` latch on a promise, is that cache written by hand, and each
 *   one got the failure and the in-flight rules wrong in its own way.
 *
 * Read syntactically (the linter has no types): a `Map`/`WeakMap` whose type names a `Promise`, and
 * a `??=` whose right side makes one (`new Promise`, an `async` IIFE, `import()`, `fetch()`, or a
 * `.then` / `.catch` / `.finally` chain). A site that is truly not a cache says why, on the line
 * before it: `// oxlint-disable-next-line ogygia/no-promise-cache -- <why>`.
 */

import { readFileSync } from 'node:fs';

type Node = { type: string; [key: string]: unknown };
type Context = {
	filename?: string;
	getFilename?: () => string;
	report(d: { node: Node; message: string }): void;
};

const SOURCE = /(^|\/)packages\/(?!machine\/)[^/]+\/src\//;

function in_source(context: Context): boolean {
	const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
	return SOURCE.test(file);
}

/** Does a type node name `Promise` anywhere inside it? */
function names_promise(t: unknown): boolean {
	if (!t || typeof t !== 'object') return false;
	const n = t as Node;
	// (a function that returns a promise is a loader, not a promise)
	if (n.type === 'TSFunctionType') return false;
	if (n.type === 'TSTypeReference') {
		const name = n.typeName as Node | undefined;
		if (name?.type === 'Identifier' && (name as { name?: string }).name === 'Promise') return true;
	}
	for (const key in n) {
		if (key === 'parent' || key === 'loc' || key === 'range') continue;
		const v = n[key];
		if (Array.isArray(v)) {
			if (v.some(names_promise)) return true;
		} else if (v && typeof v === 'object' && names_promise(v)) return true;
	}
	return false;
}

/** The type arguments of `Map<…>` / `WeakMap<…>` (a `new` or a type reference), if it is one. */
function map_type_args(n: Node): unknown[] | null {
	const callee = (n.type === 'NewExpression' ? n.callee : n.typeName) as Node | undefined;
	const name = callee?.type === 'Identifier' ? (callee as { name?: string }).name : undefined;
	if (name !== 'Map' && name !== 'WeakMap') return null;
	const args = (n.typeArguments ?? n.typeParameters) as { params?: unknown[] } | undefined;
	return args?.params ?? null;
}

/** Does this expression make a promise, by its shape? */
function makes_promise(e: unknown): boolean {
	if (!e || typeof e !== 'object') return false;
	const n = e as Node;
	switch (n.type) {
		case 'NewExpression':
			return (
				(n.callee as Node)?.type === 'Identifier' &&
				(n.callee as { name?: string }).name === 'Promise'
			);
		case 'ImportExpression':
			return true;
		case 'AwaitExpression':
			return false;
		case 'ParenthesizedExpression':
		case 'TSAsExpression':
		case 'TSNonNullExpression':
			return makes_promise(n.expression);
		case 'CallExpression': {
			const callee = n.callee as Node;
			if (callee.type === 'Identifier') return (callee as { name?: string }).name === 'fetch';
			if (callee.type === 'MemberExpression') {
				const prop = callee.property as { name?: string };
				if (prop?.name === 'then' || prop?.name === 'catch' || prop?.name === 'finally')
					return true;
				return false;
			}
			// an async IIFE
			const fn = callee.type === 'ParenthesizedExpression' ? (callee.expression as Node) : callee;
			return (
				(fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression') &&
				(fn as { async?: boolean }).async === true
			);
		}
		default:
			return false;
	}
}

const MESSAGE_MAP =
	'A Map of promises is a hand-written async cache: use flights() from @ogygia/machine (one flight per key, a failure never kept).';
const MESSAGE_LATCH =
	'A `??=` latch on a promise is a hand-written one-key cache: use flights() from @ogygia/machine (a failure never kept).';

const no_promise_cache = {
	meta: {
		type: 'problem',
		docs: { description: 'Shared async work is a flights(), not a Map of promises or a ??= latch.' }
	},
	create(context: Context) {
		if (!in_source(context)) return {};
		const map = (node: Node) => {
			// (what it holds: its value type)
			const args = map_type_args(node);
			if (args?.length && names_promise(args[args.length - 1]))
				context.report({ node, message: MESSAGE_MAP });
		};
		return {
			NewExpression: map,
			TSTypeReference: map,
			AssignmentExpression(node: Node) {
				if (node.operator === '??=' && makes_promise(node.right))
					context.report({ node, message: MESSAGE_LATCH });
			}
		};
	}
};

const TIMERS = new Set([
	'setTimeout',
	'setInterval',
	'requestAnimationFrame',
	'requestIdleCallback'
]);
const OBSERVERS = new Set([
	'MutationObserver',
	'IntersectionObserver',
	'ResizeObserver',
	'PerformanceObserver'
]);
const GLOBALS = new Set(['window', 'globalThis', 'self']);

/** The name a call reaches: `f(…)`, or `window.f(…)` / `globalThis.f(…)` / `el.f(…)`. */
function called(n: Node): { name: string; on_global: boolean; member: boolean } | null {
	const callee = n.callee as Node;
	if (callee?.type === 'Identifier')
		return { name: (callee as { name: string }).name, on_global: true, member: false };
	if (callee?.type === 'MemberExpression' && !(callee as { computed?: boolean }).computed) {
		const obj = callee.object as Node;
		const on_global = obj?.type === 'Identifier' && GLOBALS.has((obj as { name: string }).name);
		return { name: (callee.property as { name: string }).name, on_global, member: true };
	}
	return null;
}

/** An options object literal that carries a `signal` (the listener is owned by it). */
function has_signal(options: unknown): boolean {
	const o = options as Node | undefined;
	if (o?.type !== 'ObjectExpression') return false;
	return (o.properties as Node[]).some(
		(p) => p.type === 'Property' && (p.key as { name?: string })?.name === 'signal'
	);
}

/** An observer made as the argument of a `.watch(…)` call (`s.watch(new IntersectionObserver(…))`):
 *  the scope disconnects it. */
function watched(n: Node): boolean {
	const parent = n.parent as Node | undefined;
	if (parent?.type !== 'CallExpression' || !(parent.arguments as unknown[]).includes(n))
		return false;
	const c = called(parent);
	return c !== null && c.member && c.name === 'watch';
}

const MESSAGE_OWNED =
	'A bare listener, timer, observer or stream with no cancel outlives whatever started it: give it an owner (scope() from @ogygia/machine: s.on, s.timeout, s.every, s.watch; a stream whose cancel closes its scope).';

/**
 * `ogygia/owned-effects`: listeners, timers, observers and streams belong to a scope (a request, a
 * region, a page visit, a component, a machine's visit), which lets them go together, exactly once.
 * Refused: `addEventListener` with no `signal`, `setTimeout` / `setInterval` /
 * `requestAnimationFrame` / `requestIdleCallback`, a `new` Mutation / Intersection / Resize /
 * Performance observer outside a scope's `watch(…)`, and a `new ReadableStream({…})` with no
 * `cancel`. One that lives as long as the process or the document says so on the line before it.
 */
const owned_effects = {
	meta: {
		type: 'problem',
		docs: { description: 'Listeners, timers, observers and streams have an owner (a scope).' }
	},
	create(context: Context) {
		if (!in_source(context)) return {};
		return {
			CallExpression(node: Node) {
				const c = called(node);
				if (!c) return;
				const args = node.arguments as unknown[];
				if (c.name === 'addEventListener' && !has_signal(args[2]))
					context.report({ node, message: MESSAGE_OWNED });
				else if (TIMERS.has(c.name) && c.on_global)
					context.report({ node, message: MESSAGE_OWNED });
			},
			NewExpression(node: Node) {
				const callee = node.callee as Node;
				const name = callee?.type === 'Identifier' ? (callee as { name: string }).name : '';
				// (made right inside a scope's `watch(…)`: owned)
				if (OBSERVERS.has(name) && !watched(node)) context.report({ node, message: MESSAGE_OWNED });
				else if (name === 'ReadableStream') {
					const source = (node.arguments as Node[])[0];
					const cancels =
						source?.type === 'ObjectExpression' &&
						(source.properties as Node[]).some(
							(p) => p.type === 'Property' && (p.key as { name?: string })?.name === 'cancel'
						);
					if (!cancels) context.report({ node, message: MESSAGE_OWNED });
				}
			}
		};
	}
};

type Comment = { type: string; value: string; loc: { start: { line: number } } };
type Located = Node & { loc: { start: { line: number }; end: { line: number } } };

/** The lines of this file that carry an `// ok: <reason>` comment (a reason, not just `ok:`). */
function ok_lines(context: Context): Set<number> {
	const comments =
		(
			context as { sourceCode?: { getAllComments?: () => Comment[] } }
		).sourceCode?.getAllComments?.() ?? [];
	const lines = new Set<number>();
	for (const c of comments) if (/^\s*ok:\s*\S/.test(c.value)) lines.add(c.loc.start.line);
	return lines;
}

/** A handler that does nothing with the failure: `() => {}`, `() => undefined`, `() => null`,
 *  `() => void 0`, or a function named `noop`. */
function swallows(handler: unknown): boolean {
	const h = handler as Node | undefined;
	if (!h) return false;
	if (h.type === 'Identifier') return (h as { name?: string }).name === 'noop';
	if (h.type !== 'ArrowFunctionExpression' && h.type !== 'FunctionExpression') return false;
	const body = h.body as Node;
	if (body.type === 'BlockStatement') return (body.body as unknown[]).length === 0;
	if (body.type === 'Identifier') return (body as { name?: string }).name === 'undefined';
	if (body.type === 'Literal') return (body as { value?: unknown }).value === null;
	if (body.type === 'UnaryExpression')
		return body.operator === 'void' && (body.argument as Node).type === 'Literal';
	return false;
}

/** `p.catch(handler)` / `p.then(ok, handler)`: the failure has a handler that does something. */
function handled(call: Node): boolean {
	const callee = call.callee as Node;
	if (callee?.type !== 'MemberExpression') return false;
	const name = (callee.property as { name?: string }).name;
	const args = call.arguments as unknown[];
	if (name === 'catch') return args.length > 0 && !swallows(args[0]);
	if (name === 'then') return args.length > 1 && !swallows(args[1]);
	return false;
}

const MESSAGE_SILENT =
	'A failure swallowed with no word: report it (a message code), re-throw it, or move a machine. One that is truly fine says why on the same line: `// ok: <reason>`.';

/**
 * `ogygia/no-silent-failures`: every caught failure reports a message code, re-throws, or moves a
 * machine; nothing is swallowed without a written reason. Refused: an empty `catch` (a comment is
 * not a body), `.catch(() => {})` (or `=> undefined`, `=> null`, `noop`), and a bare `void <call>()`,
 * whose rejection goes unhandled unless the callee catches it (`void p.catch(report)` is handled).
 * A site that is truly fine carries `// ok: <reason>` on its first or last line (for a catch, also
 * inside its body).
 */
const no_silent_failures = {
	meta: {
		type: 'problem',
		docs: {
			description: 'A caught failure reports, re-throws or moves a machine, or says why not.'
		}
	},
	create(context: Context) {
		if (!in_source(context)) return {};
		let ok: Set<number> | null = null;
		const marked = (node: Node): boolean => {
			const n = node as Located;
			ok ??= ok_lines(context);
			for (let line = n.loc.start.line; line <= n.loc.end.line; line++) {
				// (first and last line; a catch also inside its body)
				if (line !== n.loc.start.line && line !== n.loc.end.line && n.type !== 'CatchClause')
					continue;
				if (ok.has(line)) return true;
			}
			return false;
		};
		const refuse = (node: Node) => {
			if (!marked(node)) context.report({ node, message: MESSAGE_SILENT });
		};
		return {
			CatchClause(node: Node) {
				if (((node.body as Node).body as unknown[]).length === 0) refuse(node);
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee?.type !== 'MemberExpression') return;
				const name = (callee.property as { name?: string }).name;
				const args = node.arguments as unknown[];
				if (name === 'catch' && swallows(args[0])) refuse(node);
				else if (name === 'then' && args.length > 1 && swallows(args[1])) refuse(node);
			},
			UnaryExpression(node: Node) {
				if (node.operator !== 'void') return;
				const arg = node.argument as Node;
				// (`void p.catch(() => {})` is the `.catch` site's, said once there)
				if (arg.type === 'CallExpression' && !handled(arg) && !swallowing_chain(arg)) refuse(node);
			}
		};
	}
};

/** `p.catch(<swallow>)` or `p.then(a, <swallow>)`: reported as a `.catch` site already. */
function swallowing_chain(call: Node): boolean {
	const callee = call.callee as Node;
	if (callee?.type !== 'MemberExpression') return false;
	const name = (callee.property as { name?: string }).name;
	const args = call.arguments as unknown[];
	return (name === 'catch' && swallows(args[0])) || (name === 'then' && swallows(args[1]));
}

/** The waits that make a stale part a stale whole (`scope.task`, a mailbox's `wait` / `ask`). */
const WAITS = new Set(['task', 'wait', 'ask']);

/** A call's method name (`x.name(…)`, `this.#x.name(…)`), or null. */
function method_of(call: Node): string | null {
	const callee = call.callee as Node;
	if (callee?.type !== 'MemberExpression' || (callee as { computed?: boolean }).computed)
		return null;
	return (callee.property as { name?: string }).name ?? null;
}

/** The receiver's name (`x.get` → `x`, `this.x.get` / `this.#x.get` → `x`), or null. */
function receiver_of(call: Node): string | null {
	const obj = (call.callee as Node).object as Node | undefined;
	if (obj?.type === 'Identifier') return (obj as { name: string }).name;
	if (obj?.type === 'MemberExpression' && (obj.object as Node)?.type === 'ThisExpression')
		return (obj.property as { name?: string }).name ?? null;
	return null;
}

/** Is `e` a `flights(…)` (or `flights.keyed<I>()(…)`) call? */
function makes_flights(e: unknown): boolean {
	let n = e as Node | undefined;
	while (n?.type === 'CallExpression') {
		const callee = n.callee as Node;
		if (callee.type === 'Identifier') return (callee as { name: string }).name === 'flights';
		if (callee.type === 'MemberExpression') {
			const obj = callee.object as Node;
			return (
				obj.type === 'Identifier' &&
				(obj as { name: string }).name === 'flights' &&
				(callee.property as { name?: string }).name === 'keyed'
			);
		}
		n = callee;
	}
	return false;
}

/** `e` with `await`, parentheses and casts taken off. */
function bare(e: Node | undefined): Node | undefined {
	while (
		e?.type === 'AwaitExpression' ||
		e?.type === 'ParenthesizedExpression' ||
		e?.type === 'TSAsExpression' ||
		e?.type === 'TSNonNullExpression'
	)
		e = (e.type === 'AwaitExpression' ? e.argument : e.expression) as Node;
	return e;
}

/** Is `call` `Promise.all(…)`? */
function is_promise_all(call: Node | undefined): boolean {
	if (call?.type !== 'CallExpression') return false;
	const callee = call.callee as Node;
	return (
		callee.type === 'MemberExpression' &&
		(callee.object as { name?: string }).name === 'Promise' &&
		(callee.property as { name?: string }).name === 'all'
	);
}

/** Is `e` handed straight to a wait: its argument, or what a function given to it returns (its
 *  expression body, or a `return` at the top of its body)? */
function waited(e: Node): boolean {
	let n: Node = e;
	let parent = n.parent as Node | undefined;
	while (
		parent?.type === 'AwaitExpression' ||
		parent?.type === 'ParenthesizedExpression' ||
		parent?.type === 'TSAsExpression'
	) {
		n = parent;
		parent = n.parent as Node | undefined;
	}
	if (parent?.type === 'ReturnStatement') {
		const block = parent.parent as Node | undefined;
		const fn = block?.parent as Node | undefined;
		if (block?.type !== 'BlockStatement' || !fn) return false;
		n = fn;
		parent = fn.parent as Node | undefined;
	} else if (parent?.type === 'ArrowFunctionExpression' && parent.body === n) {
		n = parent;
		parent = n.parent as Node | undefined;
	}
	if (parent?.type !== 'CallExpression' || !(parent.arguments as unknown[]).includes(n))
		return false;
	const m = method_of(parent);
	return m !== null && WAITS.has(m);
}

const MESSAGE_STALE_PART =
	'A STALE-returning call inside a Promise.all or an array is a slot that can be STALE: hand the whole to a wait (`scope.task(() => Promise.all([…]))`, `turn.wait(Promise.all([…]))`), which gives STALE when any part is. One that is truly checked slot by slot says why on the line: `// ok: <reason>`.';
const MESSAGE_STALE_FIELD =
	'A wait looks one level deep: a STALE-returning call inside an object it is handed is not seen. Hand the wait an array (`Promise.all([…])`) and build the object after the check.';

/**
 * `ogygia/stale-whole`: if anything a wait waited on is stale, the whole wait is (`STALE` itself,
 * or an array with `STALE` in it, one level deep). So a STALE-returning call (`.task(…)`,
 * `.wait(…)`, `.ask(…)`, and the `.get(…)` of a flights made in the same file) inside a
 * `Promise.all` or an array must reach a wait whole, or each slot is a STALE nobody checks.
 * Refused: such a call in an array or a `Promise.all` (directly, or returned by its `.map`
 * callback) that is not handed straight to a wait; and such a call in an object handed to a wait
 * (the wait does not look inside objects). Read syntactically: a flights from another module is not
 * known by name.
 */
const stale_whole = {
	meta: {
		type: 'problem',
		docs: { description: 'A stale part of a Promise.all reaches a wait whole.' }
	},
	create(context: Context) {
		if (!in_source(context)) return {};
		const flights_names = new Set<string>();
		const calls: Node[] = [];
		let ok: Set<number> | null = null;
		const stale_call = (e: Node | undefined): boolean => {
			const n = bare(e);
			if (n?.type !== 'CallExpression') return false;
			const m = method_of(n);
			if (m === null) return false;
			if (WAITS.has(m)) return true;
			if (m !== 'get') return false;
			const r = receiver_of(n);
			return r !== null && flights_names.has(r);
		};
		/** The array or Promise.all `call` sits in as a slot, if any. */
		const container_of = (call: Node): Node | null => {
			let n: Node = call;
			let parent = n.parent as Node | undefined;
			while (parent?.type === 'AwaitExpression' || parent?.type === 'ParenthesizedExpression') {
				n = parent;
				parent = n.parent as Node | undefined;
			}
			// (returned by a `.map` callback: the slot is the map's)
			if (parent?.type === 'ArrowFunctionExpression' && parent.body === n) {
				const map = parent.parent as Node | undefined;
				if (map?.type === 'CallExpression' && method_of(map) === 'map') {
					n = map;
					parent = map.parent as Node | undefined;
				} else return null;
			}
			if (parent?.type === 'ArrayExpression') {
				const holder = parent.parent as Node | undefined;
				return is_promise_all(holder) ? (holder as Node) : parent;
			}
			if (is_promise_all(parent)) return parent as Node;
			return null;
		};
		return {
			VariableDeclarator(node: Node) {
				const id = node.id as Node;
				if (id?.type === 'Identifier' && makes_flights(node.init))
					flights_names.add((id as { name: string }).name);
			},
			PropertyDefinition(node: Node) {
				const key = node.key as { name?: string };
				if (key?.name && makes_flights(node.value)) flights_names.add(key.name);
			},
			CallExpression(node: Node) {
				calls.push(node);
			},
			'Program:exit'() {
				ok = ok_lines(context);
				for (const call of calls) {
					// an object of STALE-returning calls handed to a wait
					const m = method_of(call);
					if (m !== null && WAITS.has(m)) {
						for (const arg of call.arguments as Node[]) {
							const body =
								arg.type === 'ArrowFunctionExpression' &&
								(arg.body as Node).type !== 'BlockStatement'
									? (arg.body as Node)
									: arg;
							const o = bare(body);
							if (o?.type !== 'ObjectExpression') continue;
							for (const p of o.properties as Node[])
								if (p.type === 'Property' && stale_call(p.value as Node))
									context.report({ node: p, message: MESSAGE_STALE_FIELD });
						}
					}
					if (!stale_call(call)) continue;
					const container = container_of(call);
					if (container === null || waited(container)) continue;
					const line = (call as Located).loc.start.line;
					if (ok.has(line) || ok.has((container as Located).loc.start.line)) continue;
					context.report({ node: call, message: MESSAGE_STALE_PART });
				}
			}
		};
	}
};

/** All of `packages/<pkg>/src`, `@ogygia/machine` included: every package's source holds the
 *  comment shapes. */
const ALL_SOURCE = /(^|\/)packages\/([^/]+)\/src\//;

type Ranged = Node & { range: [number, number] };
type FullComment = Comment & { range: [number, number]; loc: { start: { line: number } } };

/** Directives a tool reads, which say why after ` -- `. */
const REASONED =
	/^\s*(oxlint-disable(-next-line|-line)?|eslint-disable(-next-line|-line)?|@ts-expect-error)\b/;
/** Directives a tool reads, which need no reason. */
const FREE =
	/^\s*(oxlint-enable|eslint-enable|svelte-ignore|[@#]__PURE__|[@#]__NO_SIDE_EFFECTS__|@vite-ignore|oxfmt-ignore|prettier-ignore|\/ <reference )/;
const WHY = /^ @why (\S.*?) \(test: (\S+) › (.+)\)$/;
/** A JSDoc that is only a type (`@type {…}`, `@satisfies {…}`): the checker reads it, as in a
 *  `.svelte` file's JS script. Its text, `*` gutters dropped, is the tag and its braces alone. */
const TYPE_ONLY = /^@(type|satisfies)\s*\{[\s\S]*\}$/;
/** TSDoc's file-level block: it documents the module, so it sits before any code. */
const PACKAGE_DOC = /(^|\s)@packageDocumentation(\s|$)/;

const MESSAGE_FREE =
	'A comment in package source is JSDoc on an export, a tool directive (`-- <reason>`), or `// @why <fact> (test: <file> › <name>)`. Make this one a test, a rule, a type or clearer code, or delete it (#512).';
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
function why_test_exists(file: string, test: string, test_name: string): boolean {
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
 * ignores, `/// <reference>` as they are; a JSDoc that is only `@type {…}` or `@satisfies {…}`), or
 * a one-line `// @why <fact> (test: <file> › <name>)` directly above its statement, whose test
 * exists. A bin's `#!` line is not a comment. Anything else is a finding. `.d.ts` files are
 * documented like exports and are not read.
 */
const structured_comments = {
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

// ── markup-from-vocabulary ──
// A marker's name is spelled once, in core's wire-markup.ts (#479): a package writes `OG_HOLE`, not
// the attribute's text, so a renamed or retired marker cannot leave a stale copy behind.

const MARKER_TEXT = /data-og(?:ygia)?-/;
const VOCABULARY = /(^|\/)packages\/core\/src\/wire-markup\.ts$/;
const MESSAGE_MARKER =
	'A `data-og-*` / `data-ogygia-*` marker is spelled once, in packages/core/src/wire-markup.ts: import its constant (core: ../wire-markup.ts; the compiler: @ogygia/core/contract; other packages: @ogygia/core/internal/server on the server, @ogygia/core/internal/instruments in the browser).';

const markup_from_vocabulary = {
	meta: {
		type: 'problem',
		docs: { description: 'Package source names markers through the wire-markup.ts constants.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!/(^|\/)packages\/[^/]+\/src\//.test(file) || VOCABULARY.test(file)) return {};
		const check = (node: Node, text: unknown) => {
			if (typeof text === 'string' && MARKER_TEXT.test(text))
				context.report({ node, message: MESSAGE_MARKER });
		};
		return {
			Literal(node: Node) {
				check(node, node.value);
			},
			TemplateElement(node: Node) {
				check(node, (node.value as { raw?: string } | undefined)?.raw);
			}
		};
	}
};

/**
 * `ogygia/one-hash` (#484): a content hash is core's `contract/hash.ts` (`id64` for identity, where a
 * collision serves the wrong thing; `bucket32` for spreading). The FNV-1a offset basis anywhere else
 * is a copy, and says why it must be one with `// hash: <why>` on its line or the line before (a
 * seeded hash, one over bytes, a client island's own copy).
 */
const FNV_BASIS = 0x811c9dc5;
const MESSAGE_HASH =
	"An FNV-1a copy: use id64 / bucket32 from core's contract/hash.ts, or say why this must be its own with `// hash: <why>`.";

const one_hash = {
	meta: {
		type: 'problem',
		docs: { description: 'One content hash implementation: contract/hash.ts.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!in_source(context) || file.endsWith('packages/core/src/contract/hash.ts')) return {};
		const found: Node[] = [];
		return {
			Literal(node: Node) {
				if ((node as { value?: unknown }).value === FNV_BASIS) found.push(node);
			},
			'Program:exit'() {
				if (!found.length) return;
				const comments =
					(
						context as { sourceCode?: { getAllComments?: () => Comment[] } }
					).sourceCode?.getAllComments?.() ?? [];
				const marked = new Set<number>();
				for (const c of comments) if (/^\s*hash:\s*\S/.test(c.value)) marked.add(c.loc.start.line);
				for (const n of found) {
					const line = (n as Located).loc.start.line;
					if (!marked.has(line) && !marked.has(line - 1))
						context.report({ node: n, message: MESSAGE_HASH });
				}
			}
		};
	}
};

// ── ogygia/compiler-boundary ──────────────────────────────────────────────
// `@ogygia/compiler` uses core only through `@ogygia/core/contract` (what both share, and core's
// own files by path); core never uses the compiler. Package source only: tests may reach across.

const PACKAGE_SRC = /(^|\/)packages\/(core|compiler)\/src\//;
/** Core, by either name: `@ogygia/core`, `ogygia`, or a subpath. */
const CORE_SPEC = /^(@ogygia\/core|ogygia)(\/|$)/;
/** The compiler: its package, or the `ogygia` subpaths that re-export it. */
const COMPILER_SPEC = /^(@ogygia\/compiler(\/|$)|ogygia\/(vite|internal\/compiler(-ids)?)$)/;
const COMPILER_MAY_USE = '@ogygia/core/contract';
const MESSAGE_CORE_USES_COMPILER =
	'Core imports the compiler. Move what both need into core’s contract/ (#488, #513).';
const MESSAGE_COMPILER_USES_CORE =
	'The compiler imports core outside `@ogygia/core/contract`. Move what both need into core’s contract/ (#488, #513).';
const MESSAGE_LEAVES_PACKAGE =
	'A relative import leaves its package. Import the other package by name (#513).';

/** Whether relative `spec` from `file` (inside `packages/<pkg>/src/`) leaves `packages/<pkg>/`. */
function leaves_package(file: string, pkg: string, spec: string): boolean {
	if (!spec.startsWith('.')) return false;
	const parts = file.slice(0, file.lastIndexOf('/')).split('/');
	for (const seg of spec.split('/')) {
		if (seg === '.' || seg === '') continue;
		if (seg === '..') parts.pop();
		else parts.push(seg);
	}
	return !`${parts.join('/')}/`.includes(`/packages/${pkg}/`);
}

const compiler_boundary = {
	meta: {
		type: 'problem',
		docs: { description: 'The compiler uses core only through its contract; core never uses it.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		const m = PACKAGE_SRC.exec(file);
		if (!m) return {};
		const pkg = m[2];
		const check = (node: Node, source: unknown) => {
			const value = (source as { value?: unknown } | null)?.value;
			if (typeof value !== 'string') return;
			if (leaves_package(file, pkg, value))
				context.report({ node, message: MESSAGE_LEAVES_PACKAGE });
			else if (pkg === 'core' && COMPILER_SPEC.test(value))
				context.report({ node, message: MESSAGE_CORE_USES_COMPILER });
			else if (pkg === 'compiler' && CORE_SPEC.test(value) && value !== COMPILER_MAY_USE)
				context.report({ node, message: MESSAGE_COMPILER_USES_CORE });
		};
		return {
			ImportDeclaration: (node: Node) => check(node, node.source),
			ExportNamedDeclaration: (node: Node) => check(node, node.source),
			ExportAllDeclaration: (node: Node) => check(node, node.source),
			ImportExpression: (node: Node) => check(node, node.source),
			TSImportType: (node: Node) => {
				const arg = node.argument as Node | undefined;
				check(node, (arg as { literal?: unknown } | undefined)?.literal ?? arg);
			}
		};
	}
};

export default {
	meta: { name: 'ogygia' },
	rules: {
		'markup-from-vocabulary': markup_from_vocabulary,
		'one-hash': one_hash,
		'no-promise-cache': no_promise_cache,
		'owned-effects': owned_effects,
		'no-silent-failures': no_silent_failures,
		'stale-whole': stale_whole,
		'structured-comments': structured_comments,
		'compiler-boundary': compiler_boundary
	}
};
