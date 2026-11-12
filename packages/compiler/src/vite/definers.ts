/**
 * DEFINER CALLS, MARKED (dev). A plugin names the calls that define things for the life of the
 * module that makes them (`b.definers('@ogygia/content', ['content'])`, `['flag']` for flags). In
 * each server module that calls one, a line at the top asks for the module's run (`defineRun(id)`
 * from @ogygia/machine, once per evaluation of the module), and each such call
 * goes through the wrapper it returns, so what the call defines is owned by that run. A module's next
 * run ends its last one: a definition the new code makes again is set again, one deleted from the
 * code is gone. Inert in a build (nothing is marked: definitions live as long as the process).
 */
import MagicString from 'magic-string';
import type { Plugin } from 'vite';
import { parse_module } from '../compiler/parse/oxc.ts';

/** A plugin's definers: the module they are imported from, and their exported names. */
export type Definers = { module: string; names: readonly string[] };

const WRAP = '__og_define';

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Named = { name?: string; value?: string };

/** Each node under `node`, depth first. */
function* nodes(node: unknown): Generator<Node> {
	if (Array.isArray(node)) {
		for (const child of node) yield* nodes(child);
		return;
	}
	if (!node || typeof node !== 'object' || typeof (node as Node).type !== 'string') return;
	yield node as Node;
	for (const key in node) if (key !== 'type') yield* nodes((node as Node)[key]);
}

/** `code` with every definer call marked, and its map; null when it calls none (or does not parse:
 *  a module mid-edit is left alone). */
export function mark_definer_calls(
	code: string,
	id: string,
	definers: readonly Definers[]
): { code: string; map: ReturnType<MagicString['generateMap']> } | null {
	const { program, ok } = parse_module(code, id);
	if (!ok) return null;
	// the local names that are a definer, and the namespaces with the names they define
	const named = new Set<string>();
	const namespaces = new Map<string, readonly string[]>();
	for (const node of nodes(program)) {
		if (node.type !== 'ImportDeclaration') continue;
		const from = (node.source as Named).value;
		const d = definers.find((x) => x.module === from);
		if (!d) continue;
		for (const s of node.specifiers as Node[]) {
			const local = (s.local as Named).name!;
			if (s.type === 'ImportNamespaceSpecifier') namespaces.set(local, d.names);
			else if (s.type === 'ImportSpecifier') {
				const imported = s.imported as Named;
				if (d.names.includes((imported.name ?? imported.value)!)) named.add(local);
			}
		}
	}
	if (!named.size && !namespaces.size) return null;
	const s = new MagicString(code);
	let marked = 0;
	for (const node of nodes(program)) {
		if (node.type !== 'CallExpression') continue;
		const callee = node.callee as Node;
		const calls =
			callee.type === 'Identifier'
				? named.has((callee as Named).name!)
				: callee.type === 'MemberExpression' &&
					!callee.computed &&
					(callee.object as Node).type === 'Identifier' &&
					(namespaces
						.get((callee.object as Node as Named).name!)
						?.includes((callee.property as Node as Named).name!) ??
						false);
		if (!calls) continue;
		s.appendLeft(callee.start, `${WRAP}(`).prependRight(callee.end, ')');
		marked++;
	}
	if (!marked) return null;
	s.prepend(
		`const ${WRAP} = globalThis[Symbol.for('ogygia.define')]?.run?.(${JSON.stringify(id)}) ?? ((fn) => fn);\n`
	);
	return { code: s.toString(), map: s.generateMap({ hires: 'boundary', source: id }) };
}

/** The dev transform: every server module that imports a definer has its definer calls marked. A
 *  normal-order plugin (plain JS, imports as written). Inert in a build. */
export function definers_plugin(definers: () => readonly Definers[]): Plugin {
	return {
		name: 'ogygia:definers',
		apply: 'serve',
		transform(code, id, options) {
			if (!options?.ssr) return null;
			const list = definers();
			if (!list.length || !list.some((d) => code.includes(d.module))) return null;
			return mark_definer_calls(code, id, list);
		}
	};
}
