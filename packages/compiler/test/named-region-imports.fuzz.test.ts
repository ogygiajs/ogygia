// Generated region-import shapes, checked against a small model of what each must do. Every shape
// a mark can take (default, named, aliased, mixed, namespace, bare, type-only), every option set
// (good and bad), and every way a binding is used (a tag, a value, or a misuse) — in a `.svelte`
// host and in a `.ts` module. Then TypeScript's organizeImports over generated files: the transform
// must give the same regions and the same code lines before and after (an editor's "organize
// imports" never changes which regions a file has).
import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import ts from 'typescript';
import {
	transformHost,
	transformTsRegions,
	regionIdentity,
	regionId,
	wrapperVirtualId
} from '../src/compiler/region/transform.ts';
import { HOST_CTX_DEFAULTS } from './_host-ctx.ts';

type HostCtx = Parameters<typeof transformHost>[2];
type TsCtx = Parameters<typeof transformTsRegions>[2];

const HOST = '/app/src/routes/+page.svelte';
const TS_FILE = '/app/src/lib/registry.ts';
const HOST_CTX: HostCtx = {
	...HOST_CTX_DEFAULTS,
	root: '/app',
	libDir: '/app/src/lib',
	readFile: () => null,
	dev: false,
	virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	wrapperPathFor: (_h: string, iid: string) => wrapperVirtualId(iid),
	devUrlFor: (p: string) => `/@id/${p}`,
	visibleMargin: '0px',
	presets: {}
};
const TS_CTX: TsCtx = {
	root: '/app',
	libDir: '/app/src/lib',
	dev: false,
	virtualPathFor: (_h: string, iid: string) => `ogygia:region/entry/${iid}.js`,
	devUrlFor: (p: string) => `/@id/${p}`,
	importKeys: undefined,
	visibleMargin: '0px'
};

type Kind = 'svelte' | 'ts';
type Shape = 'default' | 'named' | 'mixed' | 'namespace' | 'bare' | 'type' | 'type_spec';
type Use = 'tag' | 'value' | 'unused' | 'call' | 'member' | 'spread' | 'typeof' | 'template';
const MISUSES: ReadonlySet<Use> = new Set(['call', 'member', 'spread', 'typeof', 'template']);

const GOOD_ATTRS = [
	`wake: 'load'`,
	`wake: 'idle'`,
	`wake: 'visible'`,
	`wake: '(min-width: 600px)'`,
	`region: 'raw'`,
	`render: 'deferred', fetch: 'load'`
];
const BAD_ATTRS = [`wake: 'whenever'`, `region: 'cooked'`, `render: 'sometimes'`];

interface Binding {
	exported: string;
	local: string;
	use: Use;
}
interface Case {
	kind: Kind;
	shape: Shape;
	spec: string;
	attrs: string;
	bindings: Binding[];
}

const EXPORTS = ['Alpha', 'Beta', 'Gamma'];
const SPECS = ['@acme/ui', './parts/index.ts', '$lib/blocks'];

const arb_case: fc.Arbitrary<Case> = fc
	.record({
		kind: fc.constantFrom<Kind>('svelte', 'ts'),
		shape: fc.constantFrom<Shape>(
			'default',
			'named',
			'named',
			'named',
			'mixed',
			'namespace',
			'bare',
			'type',
			'type_spec'
		),
		spec: fc.constantFrom(...SPECS),
		attrs: fc.oneof(
			{ weight: 4, arbitrary: fc.constantFrom(...GOOD_ATTRS) },
			{ weight: 1, arbitrary: fc.constantFrom(...BAD_ATTRS) }
		),
		names: fc.subarray(EXPORTS, { minLength: 1 }),
		aliases: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
		uses: fc.array(
			fc.oneof(
				{ weight: 6, arbitrary: fc.constantFrom<Use>('tag', 'value', 'unused') },
				{
					weight: 1,
					arbitrary: fc.constantFrom<Use>('call', 'member', 'spread', 'typeof', 'template')
				}
			),
			{ minLength: 4, maxLength: 4 }
		)
	})
	.map(({ kind, shape, spec, attrs, names, aliases, uses }) => {
		const bindings: Binding[] = [];
		if (shape === 'default' || shape === 'mixed')
			bindings.push({ exported: 'default', local: 'Def', use: uses[3] });
		if (shape !== 'default')
			names.forEach((n, i) =>
				bindings.push({ exported: n, local: aliases[i] ? `${n}X` : n, use: uses[i] })
			);
		return { kind, shape, spec, attrs, bindings };
	});

function import_line(c: Case): string {
	const named = c.bindings
		.filter((b) => b.exported !== 'default')
		.map((b, i) => {
			const one = b.local === b.exported ? b.local : `${b.exported} as ${b.local}`;
			return c.shape === 'type_spec' && i === 0 ? `type ${one}` : one;
		});
	const def = c.bindings.find((b) => b.exported === 'default');
	const w = `with { ${c.attrs} }`;
	switch (c.shape) {
		case 'bare':
			return `import '${c.spec}' ${w};`;
		case 'namespace':
			return `import * as NS from '${c.spec}' ${w};`;
		case 'type':
			return `import type { ${named.join(', ')} } from '${c.spec}' ${w};`;
		case 'default':
			return `import ${def!.local} from '${c.spec}' ${w};`;
		case 'mixed':
			return `import ${def!.local}, { ${named.join(', ')} } from '${c.spec}' ${w};`;
		default:
			return `import { ${named.join(', ')} } from '${c.spec}' ${w};`;
	}
}

/** A statement (script) and a markup chunk for one binding's use. */
function use_of(b: Binding, kind: Kind): { script: string; markup: string } {
	const L = b.local;
	switch (b.use) {
		case 'tag':
			return kind === 'svelte'
				? { script: '', markup: `<${L} />` }
				: { script: `export const t_${L} = ${L};`, markup: '' };
		case 'value':
			return { script: `export const v_${L} = { c: ${L} };`, markup: '' };
		case 'unused':
			return { script: '', markup: '' };
		case 'call':
			return { script: `export const c_${L} = ${L}();`, markup: '' };
		case 'member':
			return { script: `export const m_${L} = ${L}.x;`, markup: '' };
		case 'spread':
			return { script: `export const s_${L} = { ...${L} };`, markup: '' };
		case 'typeof':
			return { script: `export const o_${L} = typeof ${L};`, markup: '' };
		case 'template':
			return { script: `export const p_${L} = \`\${${L}}\`;`, markup: '' };
	}
}

function source_of(c: Case, imports = import_line(c)): string {
	const uses = c.bindings.map((b) => use_of(b, c.kind));
	// `export` is not legal in an instance script; there the statements are plain consts
	const script = uses
		.map((u) => (c.kind === 'svelte' ? u.script.replace(/^export /, '') : u.script))
		.filter(Boolean)
		.join('\n');
	if (c.kind === 'ts') return `${imports}\n${script}\nexport const n = 1;\n`;
	return `<script lang="ts">\n${imports}\n${script}\n</script>\n\n${uses.map((u) => u.markup).join('')}<div></div>\n`;
}

function compile(c: Case, src = source_of(c)) {
	return c.kind === 'ts'
		? transformTsRegions(src, TS_FILE, TS_CTX)
		: transformHost(src, HOST, HOST_CTX);
}

function outcome(fn: () => unknown): { code: string } | { value: unknown } {
	try {
		return { value: fn() };
	} catch (e) {
		return { code: (e as { code?: string }).code ?? `uncoded: ${(e as Error).message}` };
	}
}

/** The code the DEFAULT form of the same attributes throws (or null) — the one option validator. */
function option_error(c: Case): string | null {
	const one: Case = {
		...c,
		shape: 'default',
		bindings: [{ exported: 'default', local: 'Def', use: 'tag' }]
	};
	const o = outcome(() => compile(one));
	return 'code' in o ? o.code : null;
}

/** A specifier's identity path, as the transform keys it (root-relative for a file). */
function spec_identity(spec: string, kind: Kind): string {
	if (spec.startsWith('$lib/')) return `src/lib/${spec.slice(5)}`;
	if (spec.startsWith('./')) return `${kind === 'ts' ? 'src/lib' : 'src/routes'}/${spec.slice(2)}`;
	return spec;
}

describe('generated region-import shapes match the model', () => {
	test('every generated case', () => {
		fc.assert(
			fc.property(arb_case, (c) => {
				const got = outcome(() => compile(c));
				// the model, in the order the build checks: shape, then options, then uses
				const expected_code =
					c.shape === 'type' || c.shape === 'type_spec'
						? 'region_import_type_only'
						: c.shape === 'namespace'
							? 'region_import_namespace'
							: c.shape === 'bare'
								? 'region_import_bare'
								: (option_error(c) ??
									(c.bindings.some((b) => MISUSES.has(b.use))
										? 'region_binding_not_component'
										: null));
				if (expected_code) {
					expect(got).toEqual({ code: expected_code });
					return;
				}
				expect('value' in got).toBe(true);
				const r = (got as { value: { code: string; islands: Array<Record<string, unknown>> } })
					.value;
				const kept = c.bindings.filter((b) => c.kind === 'ts' || b.use !== 'unused');
				if (kept.length === 0) {
					// nothing used: the dead import is dropped and no region is made
					if (r) expect(r.islands).toHaveLength(0);
					return;
				}
				expect(r.islands).toHaveLength(kept.length);
				const base = spec_identity(c.spec, c.kind);
				const identities = r.islands.map((i) => String(i.identity).split('\0')[0]).sort();
				expect(identities).toEqual(
					kept.map((b) => (b.exported === 'default' ? base : `${base}#${b.exported}`)).sort()
				);
				const entries = r.islands.map((i) => `${i.source}\n${i.bindingSsrSource}`).join('\n');
				for (const b of kept) {
					expect(r.code).toMatch(
						new RegExp(`import ${b.local} from "ogygia:region/(binding|wrapper)/[0-9a-f]{12}`)
					);
					if (b.exported !== 'default') expect(entries).toContain(`{ ${b.exported} as __Og`);
				}
				// the marked specifier is no longer imported by the host
				expect(r.code).not.toContain(`from '${c.spec}' with`);
			}),
			{ numRuns: 400 }
		);
	});
});

// ── TypeScript organizeImports over generated files ─────────────────────────────────────────────

/** Run TS organizeImports (sort + combine, never removing an unused import) over one `.ts` text. */
function organize(text: string): string {
	const file = '/virtual/file.ts';
	const host: ts.LanguageServiceHost = {
		getScriptFileNames: () => [file],
		getScriptVersion: () => '1',
		getScriptSnapshot: (f) => (f === file ? ts.ScriptSnapshot.fromString(text) : undefined),
		getCurrentDirectory: () => '/virtual',
		getCompilationSettings: () => ({
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			noResolve: true,
			noLib: true
		}),
		getDefaultLibFileName: () => 'lib.d.ts',
		fileExists: (f) => f === file,
		readFile: (f) => (f === file ? text : undefined)
	};
	const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
	const changes = ls.organizeImports(
		{ type: 'file', fileName: file, mode: ts.OrganizeImportsMode.SortAndCombine },
		{},
		{}
	);
	let out = text;
	const edits = changes.flatMap((c) => c.textChanges).sort((a, b) => b.span.start - a.span.start);
	for (const e of edits)
		out = out.slice(0, e.span.start) + e.newText + out.slice(e.span.start + e.span.length);
	return out;
}

interface Decl {
	spec: string;
	attrs: string | null;
	names: string[];
}

const arb_file = fc
	.record({
		kind: fc.constantFrom<Kind>('svelte', 'ts'),
		decls: fc.array(
			fc.record({
				spec: fc.constantFrom('@acme/ui', '$lib/blocks'),
				attrs: fc.constantFrom<string | null>(
					null,
					null,
					`wake: 'idle'`,
					`wake: 'load'`,
					`region: 'raw'`
				)
			}),
			{ minLength: 1, maxLength: 6 }
		)
	})
	.map(({ kind, decls }) => {
		// every binding name is unique across the file (an organizer may move it, never rename it)
		let n = 0;
		const out: Decl[] = decls.map((d) => ({
			...d,
			names: [`C${n++}`, ...(n % 2 ? [`C${n++}`] : [])]
		}));
		return { kind, decls: out };
	});

function file_text(f: { kind: Kind; decls: Decl[] }, imports: string): string {
	const names = f.decls.flatMap((d) => d.names);
	if (f.kind === 'ts') return `${imports}\nexport const all = [${names.join(', ')}];\n`;
	return `<script lang="ts">\n${imports}\n</script>\n\n${names.map((x) => `<${x} />`).join('')}\n`;
}

/** The parts of a transform result an organizer must not change: regions, and the code's lines. */
function normal(r: ReturnType<typeof transformHost> | ReturnType<typeof transformTsRegions>) {
	if (!r) return null;
	const islands = [...r.islands].map((i) => JSON.stringify(i, Object.keys(i).sort())).sort();
	const lines = r.code
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
		.sort();
	return { islands, lines };
}

describe('TypeScript organizeImports never changes the regions a file has', () => {
	test('generated files: same regions and the same code lines before and after', () => {
		fc.assert(
			fc.property(arb_file, (f) => {
				const imports = f.decls
					.map(
						(d) =>
							`import { ${d.names.join(', ')} } from '${d.spec}'${d.attrs ? ` with { ${d.attrs} }` : ''};`
					)
					.join('\n');
				const organized = organize(imports);
				const before = file_text(f, imports);
				const after = file_text(f, organized);
				const run = (src: string) =>
					f.kind === 'ts'
						? transformTsRegions(src, TS_FILE, TS_CTX)
						: transformHost(src, HOST, HOST_CTX);
				expect(normal(run(after))).toEqual(normal(run(before)));
			}),
			{ numRuns: 200 }
		);
	});

	test(`organizeImports keeps a marked import apart from a plain one (TS ${ts.version})`, () => {
		const out = organize(
			`import { B } from 'x';\nimport { A } from 'x' with { wake: 'idle' };\nimport { C } from 'x' with { wake: 'idle' };\nimport { D } from 'x' with { wake: 'load' };\n`
		);
		expect(out).toContain(`import { B } from 'x';`);
		expect(out).toMatch(/import \{ A,\s*C \} from 'x' with \{ wake: 'idle' \};/);
		expect(out).toContain(`import { D } from 'x' with { wake: 'load' };`);
	});
});
