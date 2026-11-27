/**
 * What a module imports at run time, for the island closure walk (`Compiler.mark_island_closure`):
 * its static imports and re-exports that are not type-only, its bare `import '…'`s, and each
 * `import()` of a literal specifier. An import inside a comment is no import, and neither is a type:
 * the bundler never loads either. A script is read from oxc's import record, a component from its
 * parse (its scripts and its template, where `{#await import('…')}` may sit).
 *
 * What it cannot see the bundler still loads: an `import()` of a computed specifier, a glob, an
 * import a transform or a macro writes. Those join the island graph when they resolve, and the
 * `island_graph_late` rule fails a rules build where one joins after its client transform.
 *
 * @packageDocumentation
 */
import { walk } from 'estree-walker';
import { module_record, type AstNode } from '../parse/oxc.ts';
import { parse_roots } from '../parse/roots.ts';
import { component_blocks, type ComponentBlock } from '../parse/scan.ts';

const IMPORT_SPEC_G =
	/\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]/g;
const LITERAL_SPEC_RE = /^(?:'([^'\\]*)'|"([^"\\]*)"|`([^`\\$]*)`)$/;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;

/** The specifiers `src` (the module at `file`) imports at run time, each once. */
export function island_imports(src: string, file: string): string[] {
	const out = file.endsWith('.svelte') ? component_imports(src, file) : script_imports(src, file);
	return out === null ? spelled_imports(src) : [...out];
}

function script_imports(src: string, file: string): Set<string> | null {
	const record = module_record(src, file);
	if (!record) return null;
	const out = new Set<string>();
	for (const imp of record.staticImports) {
		let value = imp.entries.length === 0;
		for (const e of imp.entries) if (!e.isType) value = true;
		if (value) out.add(imp.moduleRequest.value);
	}
	for (const exp of record.staticExports)
		for (const e of exp.entries) if (e.moduleRequest && !e.isType) out.add(e.moduleRequest.value);
	for (const dyn of record.dynamicImports) {
		const m = LITERAL_SPEC_RE.exec(src.slice(dyn.moduleRequest.start, dyn.moduleRequest.end));
		if (m) out.add(m[1] ?? m[2] ?? m[3]);
	}
	return out;
}

function component_imports(src: string, file: string): Set<string> | null {
	const blocks = component_blocks(src);
	const scripts: ComponentBlock[] = [];
	let instance = 0;
	let markup = '';
	let at = 0;
	for (const b of blocks) {
		markup += src.slice(at, b.open);
		at = b.close;
		if (b.kind !== 'script') continue;
		scripts.push(b);
		if (!b.module) instance++;
	}
	if (scripts.length - instance > 1 || instance > 1) return parsed_component_imports(src, file);
	if (DYNAMIC_IMPORT_RE.test(markup + src.slice(at))) return parsed_component_imports(src, file);
	const out = new Set<string>();
	for (const b of scripts) {
		const lang = b.lang === 'ts' || b.lang === 'typescript' ? 'ts' : 'js';
		const found = script_imports(src.slice(b.start, b.end), `${file}.${lang}`);
		if (found === null) return parsed_component_imports(src, file);
		for (const spec of found) out.add(spec);
	}
	return out;
}

function parsed_component_imports(src: string, file: string): Set<string> | null {
	const roots = parse_roots(src, file, 'svelte');
	if (!roots) return null;
	const out = new Set<string>();
	for (const root of roots)
		walk(root as never, {
			enter(n) {
				const spec = runtime_spec(n as unknown as AstNode);
				if (spec !== null) out.add(spec);
			}
		});
	return out;
}

function runtime_spec(node: AstNode): string | null {
	switch (node.type) {
		case 'ImportDeclaration': {
			if (node.importKind === 'type') return null;
			const specifiers: AstNode[] = node.specifiers ?? [];
			let value = specifiers.length === 0;
			for (const s of specifiers) if (s.importKind !== 'type') value = true;
			return value ? literal(node.source) : null;
		}
		case 'ExportAllDeclaration':
		case 'ExportNamedDeclaration':
			return node.exportKind === 'type' ? null : literal(node.source);
		case 'ImportExpression':
			return literal(node.source);
		default:
			return null;
	}
}

function literal(n: AstNode | null | undefined): string | null {
	if (!n) return null;
	if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
	if (n.type === 'TemplateLiteral' && n.expressions?.length === 0)
		return n.quasis?.[0]?.value?.cooked ?? null;
	return null;
}

function spelled_imports(src: string): string[] {
	const out = new Set<string>();
	for (const m of src.matchAll(IMPORT_SPEC_G)) {
		const spec = m[1] || m[2] || m[3];
		if (spec) out.add(spec);
	}
	return [...out];
}
