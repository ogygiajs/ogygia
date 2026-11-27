type HastNode = { type?: string; value?: string; children?: HastNode[] };

const TAG_START = /[A-Za-z/!?]/;
const TAG_NAME_START = /[A-Za-z/]/;

/** `value` with every `<` that cannot start a tag, outside tags and braces, written as `&lt;`. */
export function escape_text_lt(value: string): string {
	if (!value.includes('<')) return value;
	const parts: string[] = [];
	let from = 0;
	let depth = 0;
	let in_tag = false;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i]!;
		if (ch === '{') depth++;
		else if (depth > 0) {
			if (ch === '}') depth--;
		} else if (in_tag) {
			if (ch === '>') in_tag = false;
		} else if (ch === '<') {
			const next = value[i + 1] ?? '';
			if (TAG_START.test(next)) in_tag = TAG_NAME_START.test(next);
			else {
				parts.push(value.slice(from, i), '&lt;');
				from = i + 1;
			}
		}
	}
	parts.push(value.slice(from));
	return parts.join('');
}

/** The rehype plugin. */
export function rehypeTextLt() {
	const walk = (node: HastNode): void => {
		if (node.type === 'text' && typeof node.value === 'string')
			node.value = escape_text_lt(node.value);
		if (Array.isArray(node.children)) for (const c of node.children) walk(c);
	};
	return (tree: HastNode): void => walk(tree);
}
