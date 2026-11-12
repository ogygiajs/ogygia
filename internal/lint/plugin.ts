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

import fs from 'node:fs';
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
		'one-hash': one_hash,
		'no-promise-cache': no_promise_cache,
		'owned-effects': owned_effects,
		'no-silent-failures': no_silent_failures,
		'stale-whole': stale_whole,
		'no-string-concat': no_string_concat,
		'prefer-dedent': prefer_dedent,
		'compiler-boundary': compiler_boundary
	}
};
