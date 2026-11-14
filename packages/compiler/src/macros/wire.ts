import { og_js_regions, type JsRegion } from '../parse/scan.ts';
import { find_og_calls } from '../parse/scan.ts';
import { parse_module, type AstNode } from '../parse/oxc.ts';
import { OgygiaError } from '../messages.ts';
import { splice_text, type Edit } from '../splice.ts';

const STATIC_WIRE_TAIL_RE = /\bstatic\s+wire\s*=\s*$/;

/** The key expression a wire member rewrites to — the same symbol the runtime registry uses. */
export const WIRE_EXPR = "Symbol.for('ogygia.wire')";
const MARKER = 'import.meta.og.wire';

type Node = AstNode;

/** If `node` is the member expression `import.meta.og.<name>`, return `<name>`; else null. */
export function og_member(node: Node | undefined): string | null {
	if (!node || node.type !== 'MemberExpression' || node.computed) return null;
	const name = node.property?.name;
	if (typeof name !== 'string') return null;
	const og = node.object;
	if (og?.type !== 'MemberExpression' || og.computed || og.property?.name !== 'og') return null;
	const meta = og.object;
	if (
		meta?.type !== 'MetaProperty' ||
		meta.meta?.name !== 'import' ||
		meta.property?.name !== 'meta'
	)
		return null;
	return name;
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

function line_of(src: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
	return line;
}

function misuse(id: string, src: string, offset: number, what: string): never {
	throw new OgygiaError('macro_wire_misuse', {
		file: id,
		line: line_of(src, offset),
		problem: what
	});
}

function ast_edits_or_null_unparsed(src: string, region: JsRegion, id: string): Edit[] | null {
	const { program, ok } = parse_module(region.code, id);
	if (!ok || !program) return null;
	const edits: Edit[] = [];
	const claimed = new Set<Node>();
	walk(program, (n) => {
		if ((n.type === 'PropertyDefinition' || n.type === 'ClassProperty') && n.static === true) {
			const v = n.value as Node | undefined;
			if (v?.type === 'CallExpression' && og_member(v.callee as Node) === 'wire') {
				const abs = region.offset + n.start;
				const key = n.key as Node | undefined;
				const name = !n.computed && key?.type === 'Identifier' ? key.name : null;
				if (name !== 'wire')
					misuse(
						id,
						src,
						abs,
						`the wire member must be named exactly \`wire\` (got \`${name ?? '<computed>'}\`)`
					);
				const args = v.arguments as Node[] | undefined;
				if (!args || args.length !== 1) {
					misuse(
						id,
						src,
						abs,
						`wire() takes exactly one argument — the codec ({ encode, decode })`
					);
				}
				claimed.add(v);
				claimed.add(v.callee as Node);
				const a = args[0]!;
				edits.push({ start: abs, end: region.offset + a.start, text: `static [${WIRE_EXPR}] = ` });
				edits.push({ start: region.offset + a.end, end: region.offset + v.end, text: '' });
			}
			return;
		}
		if (n.type === 'CallExpression' && og_member(n.callee as Node) === 'wire' && !claimed.has(n)) {
			misuse(id, src, region.offset + n.start, `wire() called outside a static class member`);
		}
		if (og_member(n) === 'wire' && !claimed.has(n)) {
			misuse(id, src, region.offset + n.start, `bare import.meta.og.wire used as a value`);
		}
	});
	edits.sort((a, b) => a.start - b.start);
	return edits;
}

function unparsed_scan_edits(src: string, region: JsRegion): Edit[] {
	const edits: Edit[] = [];
	const code = region.code;
	for (const call of find_og_calls(code, 'import.meta.og.')) {
		if (call.method !== 'wire') continue;
		const before = code.slice(0, call.start);
		const m = STATIC_WIRE_TAIL_RE.exec(before);
		if (!m) continue;
		const inner = call.args.trim();
		if (!inner) continue;
		edits.push({
			start: region.offset + m.index,
			end: region.offset + call.end,
			text: `static [${WIRE_EXPR}] = ${inner}`
		});
	}
	return edits;
}

/**
 * Rewrite every wire mark in `src`, enforcing the strict position rules. Extension-aware:
 * whole-file for JS/TS, `<script>` blocks for `.svelte`. Returns the input unchanged (same
 * reference) when there is nothing to do. Throws (build-error voice, file:line) on any misuse.
 * `markup_exts` is the resolved construct-host set (the plugin passes `['.svelte']`).
 */
export function rewrite_wire(src: string, id: string, markup_exts: readonly string[]): string {
	return splice_text(src, wire_edits(src, id, markup_exts));
}

/** The edits `rewrite_wire` makes to `src`: none when there is nothing to do. */
export function wire_edits(src: string, id: string, markup_exts: readonly string[]): Edit[] {
	if (!src.includes(MARKER)) return [];
	const regions = og_js_regions(src, id, markup_exts);
	if (!regions) return [];
	const edits: Edit[] = [];
	for (const region of regions)
		edits.push(
			...(ast_edits_or_null_unparsed(src, region, id) ?? unparsed_scan_edits(src, region))
		);
	return edits;
}
