/**
 * The repo's own lint rules (an oxlint JS plugin, `.oxlintrc.json` → `jsPlugins`). They hold the
 * 0.13 rules for package source (`packages/<pkg>/src`), outside `@ogygia/machine` itself, which is
 * where the primitives they point at live:
 *
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

export default {
	meta: { name: 'ogygia' },
	rules: { 'no-promise-cache': no_promise_cache, 'owned-effects': owned_effects }
};
