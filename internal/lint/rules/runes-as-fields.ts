// ── ogygia/runes-as-fields ────────────────────────────────────────────────
// A class in a .svelte.ts or .svelte file of package source declares its $state and $derived values
// as fields at the top of the class. Its constructor only stores its inputs: a derived is lazy, so
// a field's first read comes after the constructor has stored what it reads.

import { ALL_SOURCE, type Context, type Node } from './shared.ts';

const MESSAGE =
	'Declare this $state / $derived as a class field (`x = $derived(...)`), not inside the constructor: the constructor only stores its inputs.';
const RUNES: ReadonlySet<string> = new Set(['$state', '$derived']);
const MEMBERS: ReadonlySet<string> = new Set(['$state.raw', '$derived.by']);

function rune_name(callee: Node): string | null {
	if (callee.type === 'Identifier')
		return RUNES.has(callee.name as string) ? (callee.name as string) : null;
	if (callee.type !== 'MemberExpression') return null;
	const obj = callee.object as Node;
	const prop = callee.property as Node;
	if (obj.type !== 'Identifier' || prop.type !== 'Identifier') return null;
	const name = `${obj.name as string}.${prop.name as string}`;
	return MEMBERS.has(name) ? name : null;
}

function in_constructor(node: Node): boolean {
	for (let n = node.parent as Node | undefined; n; n = n.parent as Node | undefined)
		if (n.type === 'MethodDefinition' && n.kind === 'constructor') return true;
	return false;
}

export const runes_as_fields = {
	meta: {
		type: 'problem',
		docs: { description: 'Runes in a class are fields, never made in its constructor.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!ALL_SOURCE.test(file) || !/\.svelte(\.ts)?$/.test(file)) return {};
		return {
			CallExpression(node: Node) {
				if (rune_name(node.callee as Node) && in_constructor(node))
					context.report({ node, message: MESSAGE });
			}
		};
	}
};
