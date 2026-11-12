import { readFileSync } from 'node:fs';
import type { UserConfig } from 'tsdown';
import { svelte, type SvelteOptions } from '@ogygia/tsdown-plugin-svelte';

/** Imports a package never bundles: the app installs its own copy of each. */
const SHARED: (string | RegExp)[] = [
	/^ogygia(\/|$)/,
	/^@ogygia\//,
	'svelte',
	/^svelte\//,
	/^@sveltejs\/kit(\/|$)/,
	/^vite(\/|$)/,
	'esm-env',
	/^node:/,
	/^virtual:/,
	/^ogygia:/,
	/^\$app\//,
	// components ship as preprocessed source beside the JS (the svelte pass): the app compiles them
	/\.svelte$/
];

/** `import.meta.resolve('./x.ts')`: a plugin naming a realm module next to its factory. */
const RESOLVE_TS_RE = /import\.meta\.resolve\((['"])(\.{1,2}\/[^'"]+?)\.ts\1\)/g;

/** A source file names its sibling `./x.ts`; the shipped file beside it is `./x.js` (the structure
 *  is kept, so the relative path holds). */
function resolve_to_js() {
	return {
		name: 'ogygia:import-meta-resolve-js',
		renderChunk(code: string) {
			const out = code.replace(
				RESOLVE_TS_RE,
				(_m, q: string, spec: string) => `import.meta.resolve(${q}${spec}.js${q})`
			);
			return out === code ? null : { code: out, map: null };
		}
	};
}

/** Core's page-markup vocabulary: each marker's `export const` line in wire-markup.ts. */
const MARKUP_SOURCE = new URL('../../core/src/wire-markup.ts', import.meta.url);
const MARKUP_CONST_RE = /^export const ([A-Z0-9_]+) = '(data-og(?:ygia)?-[a-z0-9-]*)';$/gm;
/** Where a module imports the vocabulary from: core's own file, or a core internal entry. */
const MARKUP_FROM_RE = /(?:^|\/)wire-markup\.js$|^@ogygia\/core\/internal(?:\/[a-z-]+)?$/;

interface Node {
	type: string;
	start: number;
	end: number;
	[key: string]: unknown;
}

const is_node = (v: unknown): v is Node =>
	typeof v === 'object' && v !== null && typeof (v as Node).type === 'string';

/** Whether `node` (an Identifier under `parent`) names a binding rather than a key or a member. */
function is_reference(node: Node, parent: Node | null): boolean {
	if (parent === null) return true;
	switch (parent.type) {
		case 'MemberExpression':
			return parent.computed === true || parent.property !== node;
		case 'Property':
			// (a shorthand's key and value are one name: its value is the reference)
			return parent.shorthand === true
				? parent.value === node
				: parent.computed === true || parent.key !== node;
		case 'PropertyDefinition':
		case 'MethodDefinition':
			return parent.computed === true || parent.key !== node;
		case 'ImportSpecifier':
		case 'ExportSpecifier':
		case 'LabeledStatement':
			return false;
		default:
			return true;
	}
}

/**
 * Each marker constant a shipped module imports from core's vocabulary, written in place as its
 * value. The packages ship unbundled, and a bundler inlines a constant only inside one chunk: a
 * boot module importing `OG_FP` from wire-markup.js, which a lazy chunk shares for the tag reader,
 * pulled the whole reader into the boot. In place, the shipped bytes are the literals they were.
 */
export function inline_markup_names() {
	const values = new Map<string, string>();
	for (const m of readFileSync(MARKUP_SOURCE, 'utf8').matchAll(MARKUP_CONST_RE))
		values.set(m[1], m[2]);
	return {
		name: 'ogygia:inline-markup-names',
		renderChunk(
			this: { parse(code: string): unknown },
			code: string,
			chunk: { fileName: string }
		): { code: string; map: null } | null {
			// (declarations name no values)
			if (/\.d\.[cm]?ts$/.test(chunk.fileName)) return null;
			if (!code.includes('wire-markup') && !code.includes('@ogygia/core/internal')) return null;
			const program = this.parse(code) as Node & { body: Node[] };
			const local = new Map<string, string>();
			const edits: { start: number; end: number; text: string }[] = [];
			// the names this module exports from its own scope (`export { OG_X }`): an entry that
			// re-exports a marker keeps it, as a local constant of its value
			const exported = new Set<string>();
			for (const decl of program.body)
				if (decl.type === 'ExportNamedDeclaration' && !decl.source)
					for (const s of decl.specifiers as Node[])
						exported.add((s.local as { name: string }).name);
			for (const decl of program.body) {
				if (decl.type !== 'ImportDeclaration') continue;
				const from = (decl.source as { value: string }).value;
				if (!MARKUP_FROM_RE.test(from)) continue;
				const specifiers = decl.specifiers as Node[];
				const kept: string[] = [];
				const named: string[] = [];
				for (const s of specifiers) {
					const name = s.type === 'ImportSpecifier' ? (s.imported as { name: string }).name : '';
					const value = values.get(name);
					if (value !== undefined) local.set((s.local as { name: string }).name, value);
					else if (s.type === 'ImportSpecifier') named.push(code.slice(s.start, s.end));
					else kept.push(code.slice(s.start, s.end));
				}
				if (kept.length + named.length === specifiers.length) continue;
				if (named.length > 0) kept.push(`{ ${named.join(', ')} }`);
				// (none left: the import goes, as core's modules carry no side effects)
				let text =
					kept.length === 0 ? '' : `import ${kept.join(', ')} from ${JSON.stringify(from)};`;
				for (const s of specifiers) {
					const name = (s.local as { name: string }).name;
					const value = local.get(name);
					if (value !== undefined && exported.has(name))
						text += `const ${name} = ${JSON.stringify(value)};`;
				}
				const end = text === '' && code[decl.end] === '\n' ? decl.end + 1 : decl.end;
				edits.push({ start: decl.start, end, text });
			}
			if (local.size === 0) return null;
			const visit = (node: Node, parent: Node | null): void => {
				if (node.type === 'ImportDeclaration') return;
				if (node.type === 'Identifier') {
					const value = local.get(node.name as string);
					if (value === undefined || !is_reference(node, parent)) return;
					if (parent?.type === 'Property' && parent.shorthand === true)
						edits.push({
							start: node.start,
							end: node.end,
							text: `${node.name}: ${JSON.stringify(value)}`
						});
					// (inside a template: `${OG_X}` becomes the name's own text)
					else if (
						parent?.type === 'TemplateLiteral' &&
						code.slice(node.start - 2, node.start) === '${' &&
						code[node.end] === '}'
					)
						edits.push({ start: node.start - 2, end: node.end + 1, text: value });
					else edits.push({ start: node.start, end: node.end, text: JSON.stringify(value) });
					return;
				}
				for (const key in node) {
					const child = node[key];
					if (Array.isArray(child)) {
						for (const c of child) if (is_node(c)) visit(c, node);
					} else if (is_node(child)) visit(child, node);
				}
			};
			visit(program, null);
			edits.sort((a, b) => a.start - b.start);
			let out = '';
			let pos = 0;
			for (const e of edits) {
				out += code.slice(pos, e.start) + e.text;
				pos = e.end;
			}
			return { code: out + code.slice(pos), map: null };
		}
	};
}

export interface LibraryOptions extends Omit<UserConfig, 'entry' | 'deps'> {
	/** Source entries. Default: every `.ts` under `src`. */
	entry?: string[];
	/** More imports to leave as imports, beyond core, Svelte, Kit and node builtins. */
	external?: (string | RegExp)[];
	/** Options for the `.svelte` component pass (@ogygia/tsdown-plugin-svelte). */
	svelte?: SvelteOptions;
}

/**
 * The build every ogygia package shares: ESM, one output file per source file (the structure is
 * kept: a `/vite` entry must load in plain node, the rest is compiled again by the app's Vite),
 * `.d.ts` beside each, `.svelte` components shipped preprocessed with their `.svelte.d.ts`, and
 * core plus the app's own libraries left as imports.
 */
export function library(options: LibraryOptions = {}): UserConfig {
	const {
		entry = ['src/**/*.ts', '!src/**/*.d.ts'],
		external = [],
		svelte: svelte_options,
		plugins = [],
		...rest
	} = options;
	return {
		entry,
		format: 'esm',
		platform: 'neutral',
		unbundle: true,
		dts: true,
		clean: true,
		...rest,
		plugins: [
			svelte(svelte_options),
			resolve_to_js(),
			inline_markup_names(),
			...(Array.isArray(plugins) ? plugins : [plugins])
		],
		deps: { neverBundle: [...SHARED, ...external] }
	};
}
