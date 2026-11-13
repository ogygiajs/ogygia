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

import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { dedent } from '../../packages/core/src/contract/dedent.ts';

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

/** An `// ok: <reason>` note: a reason, not just `ok:`. */
const OK_NOTE = /^\s*ok:\s*\S/;

/** The lines of this file that carry an `// ok: <reason>` comment. */
function ok_lines(context: Context): Set<number> {
	const comments =
		(
			context as { sourceCode?: { getAllComments?: () => Comment[] } }
		).sourceCode?.getAllComments?.() ?? [];
	const lines = new Set<number>();
	for (const c of comments) if (OK_NOTE.test(c.value)) lines.add(c.loc.start.line);
	return lines;
}

type PlacedComment = {
	value: string;
	loc: { start: { line: number; column: number }; end: { line: number } };
};

/**
 * What a reason note (`// <tag>: <why>`, matched by `note`) excuses: a node on the note's own line,
 * and on the line below a note that stands alone on its line. A note trailing a statement is that
 * statement's, never the next one's (#1033, internal/lint/reason-notes.test.ts).
 */
function reason_notes(context: Context, note: RegExp): (node: Node) => boolean {
	const source = (
		context as { sourceCode?: { getAllComments?: () => PlacedComment[]; lines?: string[] } }
	).sourceCode;
	const lines = new Set<number>();
	for (const c of source?.getAllComments?.() ?? []) {
		if (!note.test(c.value)) continue;
		const { line, column } = c.loc.start;
		lines.add(line);
		if ((source?.lines?.[line - 1] ?? '').slice(0, column).trim() === '')
			lines.add(c.loc.end.line + 1);
	}
	return (node) => lines.has((node as Located).loc.start.line);
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
	'A comment in package source is JSDoc on an export, a tool directive (`-- <reason>`), an `// ok: <reason>` note on a failure that is fine, or `// @why <fact> (test: <file> › <name>)`. Make this one a test, a rule, a type or clearer code, or delete it (#512).';
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

// ── ogygia/html-sink ──────────────────────────────────────────────────────

/** The one module allowed to turn a string into DOM. */
const HTML_SINK_FILE = /(^|\/)packages\/core\/src\/runtime\/html-sink\.ts$/;
/** Assigning these parses a string into DOM. */
const HTML_SETTERS = new Set(['innerHTML', 'outerHTML']);
/** Naming these (to call them, or to read them off an element) parses a string into DOM. */
const HTML_PARSERS = new Set([
	'setHTMLUnsafe',
	'parseHTMLUnsafe',
	'createContextualFragment',
	'insertAdjacentHTML'
]);

const MESSAGE_SINK =
	'A string becomes DOM only in the HTML sink (packages/core/src/runtime/html-sink.ts), from a VerifiedHtml one of its vouchers made. Parse through it.';
const MESSAGE_VOUCH =
	'Only the HTML sink makes a VerifiedHtml (its vouchers, each named by the check it made): a cast skips the check.';

const property_name = (n: Node | undefined): string | undefined =>
	n?.type === 'MemberExpression' ? (n.property as { name?: string }).name : undefined;

/** Does a type node name `VerifiedHtml`? */
function names_verified(t: unknown): boolean {
	const n = t as Node | undefined;
	if (n?.type === 'TSTypeReference') {
		const name = n.typeName as { name?: string } | undefined;
		return name?.name === 'VerifiedHtml';
	}
	if (n?.type === 'TSIntersectionType' || n?.type === 'TSUnionType')
		return (n.types as unknown[]).some(names_verified);
	return false;
}

/**
 * `ogygia/structured-comments` (#512): in `packages/<pkg>/src`, a comment is one of three shapes:
 * JSDoc on an export (or on a member of an exported class, type or object constant, on a
 * component's props type and its members, or a `@packageDocumentation` block before any code), a
 * tool directive (`oxlint-disable…` and
 * `@ts-expect-error` with ` -- <reason>`; `svelte-ignore`, `@__PURE__`, `@vite-ignore`, formatter
 * ignores, `/// <reference>` as they are; a JSDoc that is only `@type {…}` or `@satisfies {…}`), a
 * line `// ok: <reason>` (the note the no-silent-failures rules ask for), or a one-line
 * `// @why <fact> (test: <file> › <name>)` directly above its statement, whose test
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
					if (c.type === 'Line' && OK_NOTE.test(value)) continue;
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

/**
 * `ogygia/html-sink` (HOLE-TRUST): a string becomes DOM in one module, from HTML it vouched for.
 * Outside it, package source may not assign `innerHTML` / `outerHTML`, name `setHTMLUnsafe`,
 * `parseHTMLUnsafe`, `createContextualFragment` or `insertAdjacentHTML`, make a `DOMParser`, call
 * `document.write`, or cast anything to `VerifiedHtml`.
 */
const html_sink = {
	meta: {
		type: 'problem',
		docs: { description: 'A string becomes DOM only in the HTML sink, from HTML it vouched for.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!/(^|\/)packages\/[^/]+\/src\//.test(file) || HTML_SINK_FILE.test(file)) return {};
		const cast = (node: Node) => {
			if (names_verified(node.typeAnnotation)) context.report({ node, message: MESSAGE_VOUCH });
		};
		return {
			AssignmentExpression(node: Node) {
				const name = property_name(node.left as Node);
				if (name !== undefined && HTML_SETTERS.has(name))
					context.report({ node, message: MESSAGE_SINK });
			},
			MemberExpression(node: Node) {
				const name = (node.property as { name?: string; value?: unknown }).name;
				if (name !== undefined && HTML_PARSERS.has(name))
					context.report({ node, message: MESSAGE_SINK });
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				const name = property_name(callee);
				if (
					(name === 'write' || name === 'writeln') &&
					((callee.object as { name?: string }).name === 'document' ||
						property_name(callee.object as Node) === 'document')
				)
					context.report({ node, message: MESSAGE_SINK });
			},
			NewExpression(node: Node) {
				if ((node.callee as { name?: string }).name === 'DOMParser')
					context.report({ node, message: MESSAGE_SINK });
			},
			TSAsExpression: cast,
			TSTypeAssertion: cast,
			TSSatisfiesExpression: cast
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
 * `ogygia/no-string-concat`: a string is built with a template literal, never with `+` / `+=`.
 * Read syntactically: a `+` chain fires when one of its operands is a string literal, a template
 * literal, a `.join()` or `String()` call, or such a chain itself; number arithmetic never does.
 * The fix writes the chain as one template literal (a number sum before the first string stays one
 * `${…}`, as `+` evaluates it). A chain across lines that builds lines of text (`\n`), or holds a
 * comment, is reported with the `dedent` hint and left for a hand fix.
 */
type Ranged = Node & { range: [number, number]; loc: Located['loc'] };
type Fixer = {
	replaceText(node: Ranged, text: string): unknown;
	insertTextAfter(node: Ranged, text: string): unknown;
	insertTextBefore(node: Ranged, text: string): unknown;
};
type FixContext = Context & {
	sourceCode: {
		getText(node: Ranged): string;
		getCommentsInside(node: Ranged): unknown[];
		readonly lines: string[];
	};
	report(d: { node: Node; message: string; fix?: (fixer: Fixer) => unknown }): void;
};

const MESSAGE_CONCAT = 'Build the string with a template literal, not `+`.';
const MESSAGE_CONCAT_LINES =
	'Build the string with a template literal, not `+` across lines: a long or multi-line one is a `dedent` template (core contract/dedent.ts).';

const unwrap = (e: Node): Node =>
	e.type === 'ParenthesizedExpression' || e.type === 'TSAsExpression'
		? unwrap(e.expression as Node)
		: e;

const is_plus = (e: Node | undefined): boolean =>
	e?.type === 'BinaryExpression' && e.operator === '+';

/** The operands of a left-leaning `+` chain, in order. */
function operands(e: Node): Node[] {
	const out: Node[] = [];
	let n = e;
	while (is_plus(n)) {
		out.push(n.right as Node);
		n = n.left as Node;
	}
	out.push(n);
	return out.reverse();
}

/** A string by its shape (see the rule's comment). */
function stringy(e: Node): boolean {
	const n = unwrap(e);
	if (n.type === 'Literal') return typeof n.value === 'string';
	if (n.type === 'TemplateLiteral') return true;
	if (n.type === 'CallExpression') {
		const callee = n.callee as Node;
		if (callee.type === 'Identifier') return (callee as { name?: string }).name === 'String';
		if (callee.type === 'MemberExpression')
			return (callee.property as { name?: string })?.name === 'join';
		return false;
	}
	if (is_plus(n)) return operands(n).some(stringy);
	return false;
}

/** `raw` (a string literal's text between its quotes) as template literal text. */
const as_template_text = (raw: string): string =>
	raw.replace(/\\[\s\S]|`|\$\{/g, (m) => (m === '`' ? '\\`' : m === '${' ? '\\${' : m));

/** One operand's part of the template. */
function part(context: FixContext, e: Node): string {
	const n = unwrap(e);
	const text = context.sourceCode.getText(n as Ranged);
	if (n.type === 'Literal' && typeof n.value === 'string')
		return as_template_text(text.slice(1, -1));
	if (n.type === 'TemplateLiteral') return text.slice(1, -1);
	// (a string chain in parentheses joins this one's template)
	if (is_plus(n) && stringy(n)) return as_template(context, n, operands(n)).slice(1, -1);
	return `\${${context.sourceCode.getText(e as Ranged)}}`;
}

/** The chain `ops` (whose top node is `top`) as one template literal. */
function as_template(context: FixContext, top: Node, ops: Node[]): string {
	const first = ops.findIndex(stringy);
	let out = '';
	if (first > 0) {
		// the operands before the first string, as `+` adds them: one `${…}`
		let prefix = top;
		for (let i = ops.length - 1; i >= first; i--) prefix = prefix.left as Node;
		out = `${out}\${${context.sourceCode.getText(prefix as Ranged)}}`;
	}
	for (let i = Math.max(first, 0); i < ops.length; i++) out += part(context, ops[i]!);
	// ('</' + 'script>' is split on purpose: in a .svelte or HTML script block a whole one closes it;
	// `\x3C` keeps it whole as a value, and no-useless-escape leaves a hex escape be)
	return `\`${out.replace(CLOSE_SCRIPT_G, '\\x3C/$1')}\``;
}

const CLOSE_SCRIPT_G = /<\/(script)/gi;

const is_import_meta_url = (e: Node | undefined): boolean =>
	e?.type === 'MemberExpression' &&
	(e.object as Node)?.type === 'MetaProperty' &&
	(e.property as { name?: string })?.name === 'url';

/**
 * Where `+` stays: a bundler reads a template literal in `import(…)` and in
 * `new URL(…, import.meta.url)` as a glob of files, so a string there keeps its shape; and a
 * function handed to `script()` or `import.meta.og.$()` ships as its own source text, whose bytes
 * are the page's.
 */
function concat_kept(node: Node): boolean {
	let child: Node = node;
	let n = node.parent as Node | undefined;
	while (n) {
		if (n.type === 'ImportExpression' && n.source === child) return true;
		if (
			n.type === 'NewExpression' &&
			(n.callee as { name?: string })?.name === 'URL' &&
			(n.arguments as Node[])[0] === child &&
			is_import_meta_url((n.arguments as Node[])[1])
		)
			return true;
		if (n.type === 'CallExpression') {
			const callee = n.callee as Node;
			const name =
				callee.type === 'Identifier'
					? (callee as { name?: string }).name
					: callee.type === 'MemberExpression'
						? (callee.property as { name?: string })?.name
						: undefined;
			if (name === 'script' || name === '$') return true;
		}
		child = n;
		n = n.parent as Node | undefined;
	}
	return false;
}

const no_string_concat = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		docs: { description: 'Strings are built with template literals, never with `+`.' }
	},
	create(context: FixContext) {
		const across_lines = (n: Ranged) => n.loc.start.line !== n.loc.end.line;
		// (a chain across lines joins onto one when it builds one line of text; one that builds lines,
		// or holds a comment, is a hand fix: a `dedent` template)
		const fixable = (n: Ranged) =>
			context.sourceCode.getCommentsInside(n).length === 0 &&
			(!across_lines(n) || !/\\n/.test(context.sourceCode.getText(n)));
		return {
			BinaryExpression(node: Node) {
				if (node.operator !== '+') return;
				// the chain's top only: a `+` whose parent adds it on the right is checked there
				// (or, in parentheses, in the chain that holds it)
				const parent = node.parent as Node | undefined;
				if (is_plus(parent)) return;
				const ops = operands(node);
				if (!ops.some(stringy) || concat_kept(node)) return;
				const n = node as Ranged;
				if (!fixable(n)) {
					context.report({
						node,
						message: across_lines(n) ? MESSAGE_CONCAT_LINES : MESSAGE_CONCAT
					});
					return;
				}
				context.report({
					node,
					message: MESSAGE_CONCAT,
					fix: (fixer) => fixer.replaceText(n, as_template(context, node, ops))
				});
			},
			AssignmentExpression(node: Node) {
				if (node.operator !== '+=' || !stringy(node.right as Node) || concat_kept(node)) return;
				const left = node.left as Node;
				const n = node as Ranged;
				// (a plain name only: a member read twice could run a getter twice)
				const simple = left.type === 'Identifier' && !is_plus(unwrap(node.right as Node));
				if (!simple || !fixable(n)) {
					context.report({
						node,
						message: across_lines(n) ? MESSAGE_CONCAT_LINES : MESSAGE_CONCAT
					});
					return;
				}
				const name = context.sourceCode.getText(left as Ranged);
				context.report({
					node,
					message: MESSAGE_CONCAT,
					fix: (fixer) =>
						fixer.replaceText(n, `${name} = \`\${${name}}${part(context, node.right as Node)}\``)
				});
			}
		};
	}
};

/**
 * `ogygia/prefer-dedent`: text of several lines is written as lines, in one `dedent` template
 * (`dedent.inline` for text that ends up on one line). It flags a string or template literal with
 * two or more `\n` escapes, and an array of string pieces joined with `'\n'` (not one line of text
 * with newlines only at its edges). No fix: a hand
 * conversion proves its bytes the same.
 */
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

const prefer_dedent = {
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
			let out = '';
			for (let i = 0; i < quasis.length; i++) {
				const c = quasis[i]!.value.cooked;
				if (c === null || c.includes(VALUE_MARK)) return null;
				out = `${out}${c}`;
				if (i < expressions.length) {
					out = `${out}${VALUE_MARK}${values.length}${VALUE_MARK}`;
					values.push(text(expressions[i]!));
				}
			}
			return out;
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
				if (n < 2) return;
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

/**
 * `ogygia/ports` (DST): every source of nondeterminism goes through a port of @ogygia/machine
 * (packages/machine/src/ports.ts), so a simulated run (internal/sim) owns all of it and one seed
 * replays a run. Package source calls none of these raw: timers, the platform's timer-backed
 * `AbortSignal.timeout` and the browser's task hooks (`timers`, `tasks`), the clocks, `new Date()`
 * included (`clock.mono()` for a duration, which a wall-clock step never moves; `clock.wall()` for
 * a timestamp that leaves the process: #472), randomness (`random`), the
 * network (`net`), what is on screen (`seen`) and storage (`storage`). It grew out of
 * `ogygia/wall-clock`, which it replaces: `Date.now()` is `clock.wall()`.
 *
 * A raw call that must stay says why on its line, or alone on the line before: `// port-ok: <why>`
 * (`reason_notes`). Code that
 * runs at build time (the compiler, Vite plugins, the CLI, test tooling) is not part of a running
 * app and is not simulated: `.oxlintrc.json` turns the rule off there.
 */
const PORT_CALLS: Record<string, string> = {
	setTimeout: 'timers.after()',
	setInterval: 'timers.every()',
	queueMicrotask: 'tasks.micro()',
	requestAnimationFrame: 'tasks.frame()',
	requestIdleCallback: 'tasks.idle()',
	fetch: 'net.fetch()',
	randomUUID: 'random.uuid()'
};
const PORT_MEMBERS: Record<string, Record<string, string>> = {
	Date: { now: 'clock.wall() (a timestamp) or clock.mono() (a duration)' },
	performance: { now: 'clock.mono()' },
	Math: { random: 'random.float()' },
	crypto: { getRandomValues: 'random.bytes()', randomUUID: 'random.uuid()' },
	// (a timer of the platform's own, which no simulated run can reach: a federation hop's)
	AbortSignal: { timeout: 'timers.timeout()' }
};
const PORT_NEWS: Record<string, string> = {
	IntersectionObserver: 'seen.observer()',
	EventSource: 'net.stream()'
};
const PORT_READS: Record<string, string> = {
	localStorage: 'storage.local()',
	sessionStorage: 'storage.session()'
};
/** Node's own randomness, imported from `node:crypto` (the process's, not the realm's). */
const PORT_IMPORTS: Record<string, string> = {
	randomBytes: 'random.bytes()',
	randomFillSync: 'random.bytes()',
	randomInt: 'random.float()',
	randomUUID: 'random.uuid()',
	getRandomValues: 'random.bytes()'
};
const CRYPTO_MODULES = new Set(['node:crypto', 'crypto']);
/** The objects a platform global is read through (`window.setTimeout`, `globalThis.fetch`). */
const REALMS = new Set(['window', 'globalThis', 'self']);
/** The ports themselves: ports.ts and its modules under ports/. */
const PORTS_FILE = /(^|\/)packages\/machine\/src\/ports(\.ts$|\/)/;
const IN_PACKAGE_SOURCE = /(^|\/)packages\/[^/]+\/src\//;

const port_message = (raw: string, port: string): string =>
	`${raw} is nondeterministic: go through the port, ${port} from @ogygia/machine (a simulated run owns it), or say why it stays raw with \`// port-ok: <why>\` on its line, or alone on the line before.`;

const ports = {
	meta: {
		type: 'problem',
		docs: { description: 'Nondeterminism goes through the ports of @ogygia/machine.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!IN_PACKAGE_SOURCE.test(file) || PORTS_FILE.test(file)) return {};
		const found: Array<{ node: Node; message: string }> = [];
		const name_of = (n: unknown): string | undefined =>
			(n as Node | undefined)?.type === 'Identifier' ? (n as { name?: string }).name : undefined;
		/** `x` itself, or `window.x` / `globalThis.x` / `self.x`: the global's name, if it is one. */
		const global_name = (n: Node): string | undefined => {
			const own = name_of(n);
			if (own !== undefined) return own;
			if (n.type !== 'MemberExpression' || n.computed) return undefined;
			const realm = name_of(n.object);
			return realm !== undefined && REALMS.has(realm) ? name_of(n.property) : undefined;
		};
		const member = (n: Node): string | undefined => {
			if (n.type !== 'MemberExpression' || n.computed) return undefined;
			const object = global_name(n.object as Node);
			const property = name_of(n.property);
			if (object === undefined || property === undefined) return undefined;
			const port = PORT_MEMBERS[object]?.[property];
			return port === undefined ? undefined : `${object}.${property}()|${port}`;
		};
		return {
			ImportDeclaration(node: Node) {
				const from = (node.source as { value?: unknown } | undefined)?.value;
				if (typeof from !== 'string' || !CRYPTO_MODULES.has(from)) return;
				for (const s of (node as { specifiers?: Node[] }).specifiers ?? []) {
					const name = name_of((s as { imported?: Node }).imported);
					if (name !== undefined && Object.hasOwn(PORT_IMPORTS, name))
						found.push({
							node: s,
							message: port_message(`${from}'s ${name}()`, PORT_IMPORTS[name])
						});
				}
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				const m = member(callee);
				if (m !== undefined) {
					const [raw, port] = m.split('|');
					found.push({ node, message: port_message(raw, port) });
					return;
				}
				const name = global_name(callee);
				if (name !== undefined && Object.hasOwn(PORT_CALLS, name))
					found.push({ node, message: port_message(`${name}()`, PORT_CALLS[name]) });
			},
			NewExpression(node: Node) {
				const name = global_name(node.callee as Node);
				if (name !== undefined && Object.hasOwn(PORT_NEWS, name))
					found.push({ node, message: port_message(`new ${name}()`, PORT_NEWS[name]) });
				// (`new Date(x)` is a plain value; with no argument it reads the clock)
				else if (name === 'Date' && !(node as { arguments?: unknown[] }).arguments?.length)
					found.push({ node, message: port_message('new Date()', 'new Date(clock.wall())') });
			},
			Identifier(node: Node) {
				const name = (node as { name?: string }).name;
				if (name === undefined || !Object.hasOwn(PORT_READS, name)) return;
				const parent = (node as { parent?: Node }).parent;
				// (a property named so, `x.localStorage` off a non-realm, or a key, is not the global)
				if (parent?.type === 'MemberExpression' && parent.property === node) {
					const realm = name_of(parent.object);
					if (realm === undefined || !REALMS.has(realm)) return;
				}
				if (parent?.type === 'Property' && parent.key === node) return;
				found.push({ node, message: port_message(name, PORT_READS[name]) });
			},
			'Program:exit'() {
				if (!found.length) return;
				const excused = reason_notes(context, /^\s*port-ok:\s*\S/);
				for (const f of found) if (!excused(f.node)) context.report(f);
			}
		};
	}
};

/**
 * `ogygia/one-hash` (#484): a content hash is core's `contract/hash.ts` (`id64` for identity, where a
 * collision serves the wrong thing; `bucket32` for spreading). The FNV-1a offset basis anywhere else
 * is a copy, and says why it must be one with `// hash: <why>` on its line, or alone on the line before (a
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
				const excused = reason_notes(context, /^\s*hash:\s*\S/);
				for (const n of found) if (!excused(n)) context.report({ node: n, message: MESSAGE_HASH });
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

// ── ogygia/one-markup-walk ────────────────────────────────────────────────
// #1370: package source reads HTML through core's tag walk (markup-walk.ts), which reads quotes,
// comments and raw text as a browser does. A regex or an indexOf over tags or attributes is a
// second reader that gets one of those wrong. A site that must stay its own says why with
// `// markup-ok: <why>` on its line, or alone on the line before.

/** The walk itself: the one place that may read tags by hand. */
const MARKUP_WALK = /(^|\/)packages\/core\/src\/markup-walk\.ts$/;
/** Carved out until the compiler's own sweep (#1370) moves its readers onto the walk. */
const MARKUP_CARVED_OUT = /(^|\/)packages\/compiler\/src\//;
/** A regex pattern that reads a tag or an attribute: to a tag's end (`[^>]`), an attribute's
 *  quoted value (`="[^"]`), or a tag's name (`<[a-z`, `<\/?(\w`). */
const READS_MARKUP = [
	/\[\^[^\]]*>[^\]]*\]/,
	/=\\?(["'])\(?(\?:)?\[\^\\?\1/,
	/<(\\?\/\??)?\(?(\?:)?\[(a-z|A-Z|\\w)/
];
/** An indexOf needle shaped like a tag: `<name`, `</name`, `</`, `<!--`. (A bare `<` or `>` is
 *  as often an escaper's prefilter as a reader, so the linter, with no types, leaves it.) */
const MARKUP_NEEDLE = /^(<\/?[A-Za-z!?]|<\/$)/;
const MESSAGE_MARKUP =
	"Reads HTML by hand (a regex or indexOf over tags or attributes): use core's tag walk (markup-walk.ts: tags, next_tag, read_tag, visit_attrs, markup_tokens, markup_text), or say why not with `// markup-ok: <why>`.";

const reads_markup = (pattern: string): boolean => READS_MARKUP.some((re) => re.test(pattern));

const one_markup_walk = {
	meta: {
		type: 'problem',
		docs: { description: "Package source reads HTML through core's tag walk." }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!in_source(context) || MARKUP_WALK.test(file) || MARKUP_CARVED_OUT.test(file)) return {};
		const found: Node[] = [];
		/** A string or template literal's text (a template's holes read as nothing). */
		const text_of = (n: Node | undefined): string | undefined => {
			if (n?.type === 'Literal' && typeof n.value === 'string') return n.value;
			if (n?.type === 'TemplateLiteral')
				return (n.quasis as Array<{ value: { raw: string } }>).map((q) => q.value.raw).join('');
			return undefined;
		};
		return {
			Literal(node: Node) {
				const regex = (node as { regex?: { pattern: string } }).regex;
				if (regex && reads_markup(regex.pattern)) found.push(node);
			},
			NewExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee.type !== 'Identifier' || (callee as { name?: string }).name !== 'RegExp') return;
				const pattern = text_of((node.arguments as Node[])[0]);
				if (pattern !== undefined && reads_markup(pattern)) found.push(node);
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				if (callee.type !== 'MemberExpression' || callee.computed) return;
				const name = (callee.property as { name?: string }).name;
				if (name !== 'indexOf' && name !== 'lastIndexOf') return;
				const needle = text_of((node.arguments as Node[])[0]);
				if (needle !== undefined && MARKUP_NEEDLE.test(needle)) found.push(node);
			},
			'Program:exit'() {
				if (!found.length) return;
				const excused = reason_notes(context, /^\s*markup-ok:\s*\S/);
				for (const n of found)
					if (!excused(n)) context.report({ node: n, message: MESSAGE_MARKUP });
			}
		};
	}
};

export default {
	meta: { name: 'ogygia' },
	rules: {
		'html-sink': html_sink,
		'one-markup-walk': one_markup_walk,
		'markup-from-vocabulary': markup_from_vocabulary,
		'one-hash': one_hash,
		'no-promise-cache': no_promise_cache,
		'owned-effects': owned_effects,
		'no-silent-failures': no_silent_failures,
		'stale-whole': stale_whole,
		'no-string-concat': no_string_concat,
		'prefer-dedent': prefer_dedent,
		'structured-comments': structured_comments,
		'compiler-boundary': compiler_boundary,
		ports
	}
};
