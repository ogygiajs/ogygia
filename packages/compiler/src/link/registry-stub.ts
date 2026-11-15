import { walk } from 'estree-walker';
import { parse_module, type AstNode } from '../parse/oxc.ts';
import { region_family } from '../ids.ts';

/**
 * `ogygia:region/registry-stub/…`: keeps a region registry (a `.ts` module of marked imports) out
 * of a csr=false page's client graph. Kit links the CSS of every module that graph reaches, but
 * what a csr=false page needs is decided at SSR, where Region links the CSS of each region that
 * renders. So on the csr=false client leg of a build, a route host's import of a registry reads the
 * registry with only its marks blanked ({@link registry_client_source}): plain imports keep their
 * edges (they render on the server, and the graph is the only thing that links their CSS). A
 * csr=true page, the island world and dev keep the real registry.
 */
export const REGISTRY_STUB_PREFIX: string = region_family('registry_stub');

/** The query that names a registry's client-leg variant (its marks blanked, everything else kept). */
export const REGISTRY_CLIENT_QUERY = '?og-registry-client';

/** The client-leg variant id of a registry: its real absolute path (relative imports resolve from
 *  the registry's own directory) plus {@link REGISTRY_CLIENT_QUERY}. */
export function registry_client_id(abs_path: string): string {
	return abs_path + REGISTRY_CLIENT_QUERY;
}

/** The registry path a client-leg variant id names, or `null` for any other id. */
export function registry_client_path(id: string): string | null {
	return id.endsWith(REGISTRY_CLIENT_QUERY) ? id.slice(0, -REGISTRY_CLIENT_QUERY.length) : null;
}

type EsNode = AstNode & {
	type: string;
	start: number;
	end: number;
};

function is_og_macro(node: EsNode | undefined, prop: string): boolean {
	return (
		node?.type === 'MemberExpression' &&
		node.property?.name === prop &&
		node.object?.type === 'MemberExpression' &&
		node.object.property?.name === 'og' &&
		node.object.object?.type === 'MetaProperty' &&
		node.object.object.meta?.name === 'import' &&
		node.object.object.property?.name === 'meta'
	);
}

/**
 * The static VALUE import specifiers of a script module — `import … from`, side-effect `import '…'`,
 * `export … from`, `export * from` (type-only forms skipped; dynamic `import()` skipped: Kit links
 * no CSS for a node's dynamic chunks). `null` when the module does not parse.
 */
export function static_script_specs(source: string, file: string): string[] | null {
	const parsed = parse_module(source, file);
	if (!parsed.ok) return null;
	const specs: string[] = [];
	for (const node of (parsed.program as EsNode).body as EsNode[]) {
		const is_from =
			node.type === 'ImportDeclaration' ||
			node.type === 'ExportAllDeclaration' ||
			(node.type === 'ExportNamedDeclaration' && node.source);
		if (!is_from || node.importKind === 'type' || node.exportKind === 'type') continue;
		const value = node.source?.value;
		if (typeof value === 'string') specs.push(value);
	}
	return specs;
}

function undefined_consts(locals: readonly string[]): string {
	return locals.length ? `const ${locals.map((l) => `${l} = undefined`).join(', ')};` : '';
}

/**
 * The registry's source with its MARKS blanked and everything else kept, or `null` when it does not
 * parse (the caller falls back to the names-only stub). A mark is an import whose `with { … }`
 * carries a region key (`region_keys`: the app's wake / render / region / preset names), default
 * or named. Each blanked binding becomes
 * `const X = undefined` so the module still links; the client leg never runs it anyway.
 */
export function registry_client_source(
	source: string,
	file: string,
	region_keys: ReadonlySet<string>
): string | null {
	const parsed = parse_module(source, file);
	if (!parsed.ok) return null;
	const body = (parsed.program as EsNode).body as EsNode[];
	const edits: { start: number; end: number; text: string }[] = [];

	walk(parsed.program as never, {
		enter(n) {
			const node = n as unknown as EsNode;
			if (node.type !== 'CallExpression') return;
			if (!is_og_macro(node.callee, 'regions')) return;
			edits.push({ start: node.start, end: node.end, text: '({})' });
			this.skip();
		}
	});

	for (const node of body) {
		if (node.type !== 'ImportDeclaration' || node.importKind === 'type') continue;
		const marked = ((node.attributes ?? []) as EsNode[]).some((a) =>
			region_keys.has(a.key?.name ?? a.key?.value)
		);
		if (!marked) continue;
		const locals = ((node.specifiers ?? []) as EsNode[]).map((s) => s.local.name as string);
		edits.push({ start: node.start, end: node.end, text: undefined_consts(locals) });
	}

	if (!edits.length) return source;
	edits.sort((a, b) => b.start - a.start);
	let out = source;
	for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
	return out;
}

const NAMES_PARAM = '?names=';
const EXPORT_DECL_G =
	/^\s*export\s+(?:async\s+)?(?:const|let|var|function\*?|class|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_G = /^\s*export\s*\{([^}]*)\}/gm;
const EXPORT_DEFAULT_RE = /^\s*export\s+default\b/m;
const IMPORT_FROM_G = /import\s+(?:type\s+)?([^'";]*?)\s*from\s*(['"])([^'"]+)\2/g;
const IMPORT_SIDE_EFFECT_RE = /^\s*$/;
const AS_RE = /\s+as\s+/;
const WS_G = /\s+/g;

/** Root-relative posix path → the stub id. `names` are the exports the stub must declare. */
export function registry_stub_id(rel_posix: string, names: Iterable<string>): string {
	const sorted = [...new Set(names)].sort();
	return `${REGISTRY_STUB_PREFIX}${encodeURIComponent(rel_posix)}.js${NAMES_PARAM}${sorted.map(encodeURIComponent).join(',')}`;
}

/** True for a (resolved or bare) stub id. */
export function is_registry_stub_id(id: string): boolean {
	const bare = id.startsWith('\0') ? id.slice(1) : id;
	return bare.startsWith(REGISTRY_STUB_PREFIX);
}

/** The export names a stub id carries (`default` included when the registry has one). */
export function registry_stub_names(id: string): string[] {
	const at = id.indexOf(NAMES_PARAM);
	if (at < 0) return [];
	return id
		.slice(at + NAMES_PARAM.length)
		.split(',')
		.filter(Boolean)
		.map(decodeURIComponent);
}

/** The stub module's source: every name as `undefined`, so the host links and nothing is shipped. */
export function registry_stub_source(names: readonly string[]): string {
	const out: string[] = [];
	for (const n of names) {
		if (n === 'default') out.push('export default undefined;\n');
		else if (/^[A-Za-z_$][\w$]*$/.test(n)) out.push(`export const ${n} = undefined;\n`);
	}
	return out.length ? out.join('') : 'export {};\n';
}

/**
 * The names a module exports, scanned from its source (declarations, `export { a, b as c }`,
 * `export default`). A textual scan — registries are plain TypeScript lists, and a name the scan
 * misses is covered by {@link imported_names} (what the host actually asks for).
 */
export function export_names(source: string): Set<string> {
	const names = new Set<string>();
	EXPORT_DECL_G.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = EXPORT_DECL_G.exec(source))) names.add(m[1]);
	EXPORT_LIST_G.lastIndex = 0;
	while ((m = EXPORT_LIST_G.exec(source))) {
		for (const part of m[1].split(',')) {
			const p = part.trim();
			if (!p) continue;
			const [, alias] = p.split(AS_RE);
			const name = (alias ?? p).trim();
			if (name === 'default' || /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
		}
	}
	if (EXPORT_DEFAULT_RE.test(source)) names.add('default');
	return names;
}

/**
 * The names `importer_source` imports from `spec` (default → `default`, named → their exported
 * names, `* as ns` → nothing extra: a namespace import links against whatever the stub declares).
 */
export function imported_names(importer_source: string, spec: string): Set<string> {
	const names = new Set<string>();
	IMPORT_FROM_G.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = IMPORT_FROM_G.exec(importer_source))) {
		if (m[3] !== spec) continue;
		const clause = m[1].replace(WS_G, ' ').trim();
		if (IMPORT_SIDE_EFFECT_RE.test(clause)) continue;
		const brace = clause.indexOf('{');
		const head = (brace >= 0 ? clause.slice(0, brace) : clause).replace(',', '').trim();
		if (head && !head.startsWith('*')) names.add('default');
		if (brace >= 0) {
			for (const part of clause.slice(brace + 1, clause.indexOf('}')).split(',')) {
				const p = part.trim().replace(/^type\s+/, '');
				if (!p) continue;
				const [exported] = p.split(AS_RE);
				const name = exported.trim();
				if (name) names.add(name);
			}
		}
	}
	return names;
}
