import { og_js_regions, find_og_calls, type JsRegion } from '../parse/scan.ts';
import { parse_module, type AstNode } from '../parse/oxc.ts';
import { og_member } from './wire.ts';
import { OgygiaError } from '../messages.ts';
import { splice_text, type Edit } from '../splice.ts';

const EXPORT_CONST_TAIL_RE = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*$/;

const MARKER = 'import.meta.og.source';
const IMPORT = `import { __og_source } from 'ogygia/internal';`;

type Node = AstNode;

function line_of(src: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
	return line;
}

function misuse(id: string, src: string, offset: number, what: string): never {
	throw new OgygiaError('macro_source_misuse', {
		file: id,
		line: line_of(src, offset),
		problem: what
	});
}

function walk(node: Node, visit: (n: Node) => void): void {
	visit(node);
	for (const key in node) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		const child = node[key];
		if (Array.isArray(child)) {
			for (const c of child)
				if (c && typeof c === 'object' && typeof c.type === 'string') walk(c, visit);
		} else if (child && typeof child === 'object' && typeof child.type === 'string') {
			walk(child, visit);
		}
	}
}

function ast_edits_or_null_unparsed(
	src: string,
	region: JsRegion,
	id: string,
	rel: string
): Edit[] | null {
	const { program, ok } = parse_module(region.code, id);
	if (!ok || !program) return null;
	const edits: Edit[] = [];
	const claimed = new Set<Node>();

	for (const stmt of (program.body ?? []) as Node[]) {
		if (stmt.type !== 'ExportNamedDeclaration') continue;
		const decl = stmt.declaration as Node | undefined;
		if (!decl || decl.type !== 'VariableDeclaration') continue;
		for (const d of (decl.declarations ?? []) as Node[]) {
			const init = d.init as Node | undefined;
			if (init?.type !== 'CallExpression' || og_member(init.callee as Node) !== 'source') continue;
			const abs = region.offset + init.start;
			if (decl.kind !== 'const') {
				misuse(id, src, abs, `a source must be \`export const\` (got \`${decl.kind}\`)`);
			}
			const name = d.id?.type === 'Identifier' ? (d.id.name as string) : null;
			if (!name) {
				misuse(id, src, abs, `a source export must be a plain identifier (no destructuring)`);
			}
			const args = (init.arguments ?? []) as Node[];
			if (args.length < 1 || args.length > 2) {
				misuse(
					id,
					src,
					abs,
					`source() takes the function (+ optional { key }) — got ${args.length} args`
				);
			}
			claimed.add(init);
			claimed.add(init.callee as Node);
			const callee = init.callee as Node;
			edits.push({
				start: region.offset + callee.start,
				end: region.offset + callee.end,
				text: `__og_source`
			});
			edits.push({
				start: region.offset + args[0]!.start,
				end: region.offset + args[0]!.start,
				text: `${JSON.stringify(`${rel}#${name}`)}, `
			});
		}
	}

	walk(program, (n) => {
		if (
			n.type === 'CallExpression' &&
			og_member(n.callee as Node) === 'source' &&
			!claimed.has(n)
		) {
			misuse(id, src, region.offset + n.start, `source() outside an \`export const\` initializer`);
		}
		if (og_member(n) === 'source' && !claimed.has(n)) {
			misuse(id, src, region.offset + n.start, `bare import.meta.og.source used as a value`);
		}
	});
	edits.sort((a, b) => a.start - b.start);
	return edits;
}

function unparsed_scan_edits(src: string, region: JsRegion, rel: string): Edit[] {
	const edits: Edit[] = [];
	const code = region.code;
	for (const call of find_og_calls(code, 'import.meta.og.')) {
		if (call.method !== 'source') continue;
		const before = code.slice(0, call.start);
		const m = EXPORT_CONST_TAIL_RE.exec(before);
		if (!m) continue;
		const inner = call.args.trim();
		if (!inner) continue;
		edits.push({
			start: region.offset + call.start,
			end: region.offset + call.end,
			text: `__og_source(${JSON.stringify(`${rel}#${m[1]}`)}, ${inner})`
		});
	}
	return edits;
}

/**
 * Rewrite every source mark in `src` (strict position rules), injecting the runtime-wrapper
 * import once. `rel` is the module's root-relative posix path (the id rail). Returns the input
 * unchanged (same reference) when there is nothing to do.
 */
export function rewrite_source(
	src: string,
	id: string,
	rel: string,
	markup_exts: readonly string[]
): string {
	return splice_text(src, source_edits(src, id, rel, markup_exts));
}

/** The edits `rewrite_source` makes to `src`: none when there is nothing to do. */
export function source_edits(
	src: string,
	id: string,
	rel: string,
	markup_exts: readonly string[]
): Edit[] {
	if (!src.includes(MARKER)) return [];
	const regions = og_js_regions(src, id, markup_exts);
	if (!regions) return [];

	const edits: Edit[] = [];
	for (const region of regions) {
		const own =
			ast_edits_or_null_unparsed(src, region, id, rel) ?? unparsed_scan_edits(src, region, rel);
		if (own.length && !edits.length)
			edits.push({ start: region.offset, end: region.offset, text: IMPORT });
		edits.push(...own);
	}
	return edits;
}
