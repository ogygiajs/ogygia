export type Node = { type: string; [key: string]: unknown };
export type Context = {
	filename?: string;
	getFilename?: () => string;
	report(d: { node: Node; message: string }): void;
};

const SOURCE = /(^|\/)packages\/(?!machine\/)[^/]+\/src\//;

export function in_source(context: Context): boolean {
	const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
	return SOURCE.test(file);
}

export type Comment = { type: string; value: string; loc: { start: { line: number } } };
export type Located = Node & { loc: { start: { line: number }; end: { line: number } } };

/** All of `packages/<pkg>/src`, `@ogygia/machine` included: every package's source holds the
 *  comment shapes. */
export const ALL_SOURCE = /(^|\/)packages\/([^/]+)\/src\//;

export type Ranged = Node & { range: [number, number]; loc: Located['loc'] };
export type Fixer = {
	replaceText(node: Ranged, text: string): unknown;
	insertTextAfter(node: Ranged, text: string): unknown;
	insertTextBefore(node: Ranged, text: string): unknown;
};
export type FixContext = Context & {
	sourceCode: {
		getText(node: Ranged): string;
		getCommentsInside(node: Ranged): unknown[];
		readonly lines: string[];
	};
	report(d: { node: Node; message: string; fix?: (fixer: Fixer) => unknown }): void;
};

export const unwrap = (e: Node): Node =>
	e.type === 'ParenthesizedExpression' || e.type === 'TSAsExpression'
		? unwrap(e.expression as Node)
		: e;

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
export function concat_kept(node: Node): boolean {
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
