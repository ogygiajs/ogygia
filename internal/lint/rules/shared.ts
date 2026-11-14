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

/** An `// ok: <reason>` note: a reason, not just `ok:`. */
export const OK_NOTE = /^\s*ok:\s*\S/;

/** The lines of this file that carry an `// ok: <reason>` comment. */
export function ok_lines(context: Context): Set<number> {
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
export function reason_notes(context: Context, note: RegExp): (node: Node) => boolean {
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
