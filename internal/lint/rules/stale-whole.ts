import { in_source, type Context, type Node } from './shared.ts';

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
	'A STALE-returning call inside a Promise.all or an array is a slot that can be STALE: hand the whole to a wait (`scope.task(() => Promise.all([…]))`, `turn.wait(Promise.all([…]))`), which gives STALE when any part is. One that is truly checked slot by slot says why on the line before: `// oxlint-disable-next-line ogygia/stale-whole -- <reason>`.';
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
export const stale_whole = {
	meta: {
		type: 'problem',
		docs: { description: 'A stale part of a Promise.all reaches a wait whole.' }
	},
	create(context: Context) {
		if (!in_source(context)) return {};
		const flights_names = new Set<string>();
		const calls: Node[] = [];
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
					context.report({ node: call, message: MESSAGE_STALE_PART });
				}
			}
		};
	}
};
