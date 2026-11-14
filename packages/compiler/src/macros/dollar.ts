import { og_js_regions } from '../parse/scan.ts';
import { match_close } from '../parse/scan.ts';
import { parse_module, type AstNode } from '../parse/oxc.ts';
import { og_member } from './wire.ts';
import { OgygiaError } from '../messages.ts';
import { splice_text, type Edit } from '../splice.ts';
import { free_references, scope_bindings } from '../free-vars.ts';

const SERVER_MODULE_RE = /\.server(\.|$|\/)/;
const WS_RE = /\s/;

const MARKER = 'import.meta.og.$';

type Node = AstNode;

const KNOWN_GLOBALS: ReadonlySet<string> = new Set([
	'undefined',
	'null',
	'true',
	'false',
	'NaN',
	'Infinity',
	'globalThis',
	'console',
	'Math',
	'JSON',
	'Date',
	'RegExp',
	'Error',
	'TypeError',
	'RangeError',
	'Object',
	'Array',
	'String',
	'Number',
	'Boolean',
	'Symbol',
	'BigInt',
	'Map',
	'Set',
	'WeakMap',
	'WeakSet',
	'Promise',
	'Proxy',
	'Reflect',
	'ArrayBuffer',
	'Uint8Array',
	'TextEncoder',
	'TextDecoder',
	'URL',
	'URLSearchParams',
	'fetch',
	'Request',
	'Response',
	'Headers',
	'FormData',
	'AbortController',
	'structuredClone',
	'queueMicrotask',
	'setTimeout',
	'clearTimeout',
	'setInterval',
	'clearInterval',
	'crypto',
	'performance',
	'atob',
	'btoa',
	'isNaN',
	'isFinite',
	'parseInt',
	'parseFloat',
	'encodeURIComponent',
	'decodeURIComponent',
	'window',
	'document',
	'navigator',
	'location',
	'arguments'
]);

function walk(
	node: Node,
	visit: (n: Node, ancestors: readonly Node[]) => void,
	ancestors: Node[] = []
): void {
	visit(node, ancestors);
	ancestors.push(node);
	for (const key in node) {
		if (key === 'type' || key === 'start' || key === 'end') continue;
		const child = node[key];
		if (Array.isArray(child)) {
			for (const c of child)
				if (c && typeof c === 'object' && typeof c.type === 'string') walk(c, visit, ancestors);
		} else if (child && typeof child === 'object' && typeof child.type === 'string') {
			walk(child, visit, ancestors);
		}
	}
	ancestors.pop();
}

function line_of(src: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
	return line;
}

function misuse(id: string, src: string, offset: number, what: string): never {
	throw new OgygiaError('macro_dollar_misuse', {
		file: id,
		line: line_of(src, offset),
		problem: what
	});
}

function captures_of(fn: Node, around: readonly Node[]): string[] {
	const bound = new Set<string>();
	for (const scope of around) for (const name of scope_bindings(scope as never)) bound.add(name);
	return free_references(fn as never).filter((name) => !KNOWN_GLOBALS.has(name) || bound.has(name));
}

function holds_mark(fn: Node): boolean {
	let found = false;
	walk(fn, (n) => {
		if (!found && n.type === 'CallExpression' && og_member(n.callee as Node) === '$') found = true;
	});
	return found;
}

const ERASED_NODES: ReadonlySet<string> = new Set([
	'TSTypeAnnotation',
	'TSTypeParameterDeclaration',
	'TSTypeParameterInstantiation',
	'TSTypeAliasDeclaration',
	'TSInterfaceDeclaration',
	'TSDeclareFunction',
	'TSAbstractMethodDefinition',
	'TSAbstractPropertyDefinition',
	'TSAbstractAccessorProperty',
	'TSIndexSignature'
]);

const TYPE_AROUND_EXPRESSION: ReadonlySet<string> = new Set([
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'TSInstantiationExpression',
	'TSTypeAssertion'
]);

const RUNTIME_TS: ReadonlyMap<string, string> = new Map([
	['TSEnumDeclaration', 'an enum'],
	['TSParameterProperty', 'a parameter property']
]);

const CLASS_MEMBERS: ReadonlySet<string> = new Set([
	'PropertyDefinition',
	'MethodDefinition',
	'AccessorProperty'
]);

const MEMBER_MODIFIER_RE =
	/(?<![\w$@.])(?:public|private|protected|readonly|override|declare)(?![\w$])/g;
const ABSTRACT_RE = /(?<![\w$@.])abstract(?![\w$])/g;

function type_only_namespace(n: Node): boolean {
	if (n.declare === true) return true;
	const body = n.body as Node | null | undefined;
	if (!body) return true;
	if (body.type === 'TSModuleDeclaration') return type_only_namespace(body);
	return ((body.body ?? []) as Node[]).every((s) => {
		const d = (s.type === 'ExportNamedDeclaration' ? s.declaration : s) as Node | null;
		if (!d) return false;
		if (d.type === 'TSModuleDeclaration') return type_only_namespace(d);
		return ERASED_NODES.has(d.type as string) || d.declare === true;
	});
}

function strip_ts_types(
	fn: Node,
	code: string,
	refuse: (at: number, problem: string) => never
): string {
	const base = fn.start as number;
	const chars = code.slice(base, fn.end as number).split('');
	const blank = (s: number, e: number): void => {
		for (let i = s - base; i < e - base; i++) if (i >= 0 && i < chars.length) chars[i] = ' ';
	};
	const blank_mark = (from: number, mark: string, to: number): void => {
		const at = code.indexOf(mark, from);
		if (at >= 0 && at < to) blank(at, at + 1);
	};
	const blank_words = (re: RegExp, from: number, to: number): void => {
		for (const m of code.slice(from, to).matchAll(re))
			blank(from + m.index, from + m.index + m[0].length);
	};
	const visit = (n: Node): void => {
		const t = n.type as string;
		if (n.declare === true || ERASED_NODES.has(t)) return blank(n.start, n.end);
		if (t === 'TSModuleDeclaration') {
			if (!type_only_namespace(n))
				refuse(n.start, `a namespace with values has runtime meaning, so $() cannot erase it`);
			return blank(n.start, n.end);
		}
		const runtime = RUNTIME_TS.get(t);
		if (runtime) refuse(n.start, `${runtime} has runtime meaning, so $() cannot erase it`);
		if (TYPE_AROUND_EXPRESSION.has(t)) {
			const expr = n.expression as Node;
			blank(n.start, expr.start);
			blank(expr.end, n.end);
		}
		if (t === 'Identifier' && n.optional === true)
			blank_mark(n.start + (n.name as string).length, '?', n.end);
		if (t === 'VariableDeclarator' && n.definite === true)
			blank_mark((n.id as Node).start + ((n.id as Node).name as string).length, '!', n.end);
		if (CLASS_MEMBERS.has(t)) {
			const key = n.key as Node;
			blank_words(MEMBER_MODIFIER_RE, n.start, key.start);
			const value = n.value as Node | null | undefined;
			if (n.optional === true) blank_mark(key.end, '?', value?.start ?? n.end);
			if (n.definite === true) blank_mark(key.end, '!', n.end);
		}
		if (t === 'ClassDeclaration' || t === 'ClassExpression') {
			if (n.abstract === true) blank_words(ABSTRACT_RE, n.start, code.indexOf('class', n.start));
			const impl = (n.implements ?? []) as Node[];
			if (impl.length)
				blank(code.lastIndexOf('implements', impl[0]!.start), impl[impl.length - 1]!.end);
		}
		const params = n.params as Node[] | undefined;
		if (params?.[0]?.type === 'Identifier' && params[0].name === 'this')
			blank(params[0].start, params[1]?.start ?? params[0].end);
		for (const key in n) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			const child = n[key];
			if (Array.isArray(child)) {
				for (const c of child)
					if (c && typeof c === 'object' && typeof c.type === 'string') visit(c);
			} else if (child && typeof child === 'object' && typeof child.type === 'string') {
				visit(child);
			}
		}
	};
	visit(fn);
	return chars.join('');
}

/** One hoisted factory, destined for the fn manifest. `factory_src` is self-contained. */
export interface DollarHoist {
	tag: string;
	factory_src: string;
}

export interface DollarResult {
	code: string;
	hoists: DollarHoist[];
}

/** The fn-manifest's entries (tag → factory source), sorted by tag: the manifest is a function of
 *  the hoists, not of the order modules transformed in (test/standalone-driver.test.ts). */
export function fn_manifest_entries(hoists: ReadonlyMap<string, string>): Array<[string, string]> {
	return [...hoists].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Rewrite every `import.meta.og.$` mark in `src`. Returns the input (same reference, empty
 * hoists) when there is nothing to do. Throws build-error voice on misuse. `rel_id` is the
 * root-relative module path used for tags; `markup_exts` as in og-wire (['.svelte']).
 */
export function rewrite_dollar(
	src: string,
	id: string,
	rel_id: string,
	markup_exts: readonly string[]
): DollarResult {
	const { edits, hoists } = dollar_edits(src, id, rel_id, markup_exts);
	return { code: splice_text(src, edits), hoists };
}

/** The edits `rewrite_dollar` makes to `src`, and its hoists: none when there is nothing to do. */
export function dollar_edits(
	src: string,
	id: string,
	rel_id: string,
	markup_exts: readonly string[]
): { edits: Edit[]; hoists: DollarHoist[] } {
	if (!src.includes(MARKER)) return { edits: [], hoists: [] };
	const regions = og_js_regions(src, id, markup_exts);
	if (!regions) return { edits: [], hoists: [] };

	const edits: Edit[] = [];
	const hoists: DollarHoist[] = [];
	let seq = 0;
	let needs_import = false;
	let needs_boundary_import = false;
	const script_scopes: Node[] = [];

	for (const region of regions) {
		const { program, ok } = parse_module(region.code, id.endsWith('.svelte') ? `${id}.ts` : id);
		if (!ok || !program) continue;
		script_scopes.push(program);

		const server_only = new Map<string, string>();
		for (const node of (program.body ?? []) as Node[]) {
			if (node.type !== 'ImportDeclaration') continue;
			const src_val = node.source?.value as string | undefined;
			if (!src_val) continue;
			const is_server =
				src_val === '$app/server' ||
				src_val.startsWith('$env/static/private') ||
				src_val.startsWith('$env/dynamic/private') ||
				SERVER_MODULE_RE.test(src_val);
			if (!is_server) continue;
			for (const sp of node.specifiers ?? []) {
				if (sp.local?.name) server_only.set(sp.local.name, src_val);
			}
		}

		const claimed = new Set<Node>();
		const refuse_at = (at: number, problem: string): never =>
			misuse(id, src, region.offset + at, problem);
		walk(program, (n, ancestors) => {
			if (n.type === 'CallExpression' && og_member(n.callee as Node) === '$') {
				const abs = region.offset + n.start;
				const args = n.arguments as Node[] | undefined;
				if (!args || args.length !== 1)
					misuse(id, src, abs, `$() takes exactly one argument — the function to hoist`);
				const fn = args[0]!;
				if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') {
					claimed.add(n);
					claimed.add(n.callee as Node);
					const expr_text = strip_ts_types(fn, region.code, refuse_at);
					const site = `${rel_id}:${line_of(src, abs)}`;
					needs_boundary_import = true;
					edits.push({
						start: abs,
						end: region.offset + n.end,
						text: `__og_boundary((${expr_text}), ${JSON.stringify(site)})`
					});
					return;
				}
				if (holds_mark(fn))
					misuse(id, src, abs, `a $() inside another $() — mark the outer one only`);
				claimed.add(n);
				claimed.add(n.callee as Node);
				const captures = captures_of(fn, ancestors);
				for (const c of captures) {
					const from = server_only.get(c);
					if (from) {
						misuse(
							id,
							src,
							abs,
							`$() captures \`${c}\` from the server-only module '${from}' — its value would ship into client HTML. Do the server work in a remote function and capture ITS result, or pass a derived, non-secret value instead`
						);
					}
				}
				const fn_text = strip_ts_types(fn, region.code, refuse_at);
				const tag = `${rel_id}#$${seq++}`;
				const factory = `(${captures.join(', ')}) => (${fn_text})`;
				hoists.push({ tag, factory_src: factory });
				needs_import = true;
				edits.push({
					start: abs,
					end: region.offset + n.end,
					text: `__og_$(${JSON.stringify(tag)}, [${captures.join(', ')}], ${factory})`
				});
				return;
			}
			if (og_member(n) === '$' && !claimed.has(n)) {
				misuse(id, src, region.offset + n.start, `bare import.meta.og.$ used as a value`);
			}
		});
		if (
			(needs_import || needs_boundary_import) &&
			!edits.some((e) => e.text.startsWith('import'))
		) {
			const names = [needs_import ? '__og_$' : '', needs_boundary_import ? '__og_boundary' : '']
				.filter(Boolean)
				.join(', ');
			edits.push({
				start: region.offset,
				end: region.offset,
				text: `import { ${names} } from 'ogygia/internal';`
			});
			needs_import = false;
			needs_boundary_import = false;
		}
	}

	const in_region = (pos: number) =>
		regions.some((r) => pos >= r.offset && pos < r.offset + r.code.length);
	type TplCall = { start: number; end: number; args: string };
	const template_calls: TplCall[] = [];
	{
		const M = 'import.meta.og.$';
		let at = -1;
		while ((at = src.indexOf(M, at + 1)) !== -1) {
			if (in_region(at)) continue;
			let open = at + M.length;
			while (open < src.length && WS_RE.test(src[open]!)) open++;
			if (src[open] !== '(') continue;
			let before = at - 1;
			while (before >= 0 && WS_RE.test(src[before]!)) before--;
			if (src[before] !== '{' && src[before] !== '(') continue;
			const close = match_close(src, open);
			if (close < 0) continue;
			template_calls.push({ start: at, end: close + 1, args: src.slice(open + 1, close) });
			at = close;
		}
	}
	let template_needs: { fn: boolean; boundary: boolean } | null = null;
	for (const call of template_calls) {
		const arg_text = call.args.trim();
		if (!arg_text) misuse(id, src, call.start, `$() takes exactly one argument`);
		const wrapped = `(${arg_text})`;
		const { program, ok } = parse_module(wrapped, id.endsWith('.svelte') ? `${id}.expr.ts` : id);
		if (!ok || !program)
			misuse(id, src, call.start, `$()'s argument does not parse as an expression`);
		const stmt = (program.body?.[0] ?? {}) as Node;
		let expr = (stmt.expression ?? {}) as Node;
		while (expr.type === 'ParenthesizedExpression') expr = expr.expression as Node;
		const expr_text = strip_ts_types(expr, wrapped, (_at, problem) =>
			misuse(id, src, call.start, problem)
		);
		if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') {
			if (holds_mark(expr))
				misuse(id, src, call.start, `a $() inside another $() — mark the outer one only`);
			const captures = captures_of(expr, script_scopes);
			const tag = `${rel_id}#$${seq++}`;
			const factory = `(${captures.join(', ')}) => (${expr_text})`;
			hoists.push({ tag, factory_src: factory });
			(template_needs ??= { fn: false, boundary: false }).fn = true;
			edits.push({
				start: call.start,
				end: call.end,
				text: `__og_$(${JSON.stringify(tag)}, [${captures.join(', ')}], ${factory})`
			});
		} else {
			const site = `${rel_id}:${line_of(src, call.start)}`;
			(template_needs ??= { fn: false, boundary: false }).boundary = true;
			edits.push({
				start: call.start,
				end: call.end,
				text: `__og_boundary((${expr_text}), ${JSON.stringify(site)})`
			});
		}
	}
	if (template_needs) {
		const first = regions[0];
		if (!first)
			misuse(id, src, 0, `og.$ in markup needs a <script> block to receive its runtime import`);
		const names = [
			template_needs.fn ? '__og_$' : '',
			template_needs.boundary ? '__og_boundary' : ''
		]
			.filter(Boolean)
			.join(', ');
		const existing = edits.find((e) => e.start === first.offset && e.text.startsWith('import { '));
		if (existing) {
			const have = existing.text.slice('import { '.length, existing.text.indexOf(' }'));
			const merged = [...new Set([...have.split(', '), ...names.split(', ')])]
				.filter(Boolean)
				.join(', ');
			existing.text = `import { ${merged} } from 'ogygia/internal';`;
		} else {
			edits.push({
				start: first.offset,
				end: first.offset,
				text: `import { ${names} } from 'ogygia/internal';`
			});
		}
	}

	if (!edits.length) return { edits: [], hoists: [] };
	return { edits, hoists };
}
