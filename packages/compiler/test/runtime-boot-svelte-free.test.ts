// INVARIANT: the browser runtime's BOOT — `runtime/core.ts` plus every feature's `install` module —
// never statically reaches Svelte. In a real app Svelte's client runtime is ONE shared chunk (~200 KB);
// anything in the boot's static graph downloads first thing in `<head>`, ahead of the page's LCP image,
// before a single island needs it (field: +1 s LCP on a content page). Svelte must arrive with the first
// hydrate (the lazy hydrate core + `ogygia:boot/hydrate-features`), when `hydrate()` needs it anyway.
//
// It regressed four ways before this test existed: a string constant imported through a server-side
// module that imports `svelte`, a rune (`$effect.root`) in a module core imported statically, the
// hydrate-only `context` / `live` / `wire` features installing their Svelte-reaching modules eagerly,
// and `remote-seeds` pulling in the APP's transport codecs (its own `src/hooks.ts`) at boot.
//
// The walk uses the TypeScript AST: only real static edges (`import … from`, `export … from`, bare
// `import '…'`); type-only imports and `import()` are not edges. A `.svelte` component, a bare `svelte` /
// `svelte/*` specifier, or a `.svelte.ts` module that CALLS a rune is a Svelte dependency.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { dedent } from '@ogygia/core/contract';
import {
	FEATURES,
	generateHydrateFeaturesSource,
	generateRemoteSeedsSource,
	generateRuntimeEntrySource
} from '../src/link/runtime-entry.ts';

const SRC = path.resolve(__dirname, '../../core/src');
const RUNTIME = path.join(SRC, 'runtime');
// The devtools graph is imported by core but dead-code-eliminated behind `__OGYGIA_DEVTOOLS__` in a
// production build (verified: no devtools bytes in the built runtime chunk); it is a dev instrument.
// The event layer (`src/events`) and the switch (`src/contract/switch.ts`) the boot reaches ARE walked:
// they live in core and must stay Svelte-free like the rest of it.
const DEVTOOLS = `${path.join(SRC, 'devtools')}${path.sep}`;
const RUNES = new Set(['$state', '$derived', '$effect', '$props', '$inspect']);
/** A component's `<script>` block (instance or module), its code in group 1. */
const SVELTE_SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
// Virtual modules that resolve to the APP's own code (the transport codecs from its `src/hooks.ts`):
// arbitrary app code can import anything — in practice `ogygia` itself, and so Svelte. The boot must
// never reach one; it is how the app's transport graph once put Svelte's runtime into `<head>`.
const APP_CODE = new Set(['ogygia:region/transport']);
// The workspace packages the runtime bundles in (not the app's own dependencies): their modules are
// part of the graph like core's own, so a lazy chunk and the boot that both import one share a file.
const BUNDLED_PACKAGES = new Map([
	['@ogygia/machine', path.resolve(__dirname, '../../machine/src/index.ts')]
]);

/** Core's own `#` imports, as the browser build resolves them from source (package.json `imports`,
 *  the `ogygia-source` then `browser` conditions): this walk is the browser's graph. */
const CORE_IMPORTS = (
	JSON.parse(fs.readFileSync(path.join(SRC, '../package.json'), 'utf8')) as {
		imports: Record<string, { 'ogygia-source': { browser: string } }>;
	}
).imports;

function resolve(from: string, spec: string): string | null {
	if (spec.startsWith('#')) {
		const target = CORE_IMPORTS[spec]?.['ogygia-source']?.browser;
		return target ? path.resolve(SRC, '..', target) : null;
	}
	const base = path.resolve(path.dirname(from), spec);
	for (const c of [base.replace(/\.js$/, '.ts'), base, `${base}.ts`]) {
		if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
	}
	return null;
}

/** The module's STATIC import edges (specifiers), and whether it calls a rune. */
function scan(file: string): { specs: string[]; runes: boolean } {
	const text = fs.readFileSync(file, 'utf8');
	// (a component's edges are its scripts' imports)
	const code = file.endsWith('.svelte')
		? [...text.matchAll(SVELTE_SCRIPT_RE)].map((m) => m[1]).join('\n')
		: text;
	const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
	const specs: string[] = [];
	let runes = false;
	for (const stmt of sf.statements) {
		if (
			ts.isImportDeclaration(stmt) &&
			stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
		) {
			const named = stmt.importClause?.namedBindings;
			const all_type =
				!stmt.importClause?.name &&
				named !== undefined &&
				ts.isNamedImports(named) &&
				named.elements.length > 0 &&
				named.elements.every((e) => e.isTypeOnly);
			if (!all_type) specs.push((stmt.moduleSpecifier as ts.StringLiteral).text);
		} else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && !stmt.isTypeOnly) {
			specs.push((stmt.moduleSpecifier as ts.StringLiteral).text);
		}
	}
	const visit = (n: ts.Node): void => {
		if (runes) return;
		if (ts.isCallExpression(n)) {
			const c = n.expression;
			const name = ts.isIdentifier(c)
				? c.text
				: ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression)
					? c.expression.text
					: '';
			if (RUNES.has(name)) runes = true;
		}
		ts.forEachChild(n, visit);
	};
	if (file.endsWith('.svelte.ts')) visit(sf);
	return { specs, runes };
}

/** Every source file in `entry`'s static graph (devtools excluded, like the walker below).
 *  `components`: follow `.svelte` imports into their scripts (island code: a region's component
 *  and its parts are what every island chunk imports). */
function static_files(entry: string, components = false): Map<string, string[]> {
	const seen = new Map<string, string[]>();
	const walk = (file: string, chain: string[]): void => {
		if (seen.has(file)) return;
		seen.set(file, chain);
		for (const spec of scan(file).specs) {
			const bundled = BUNDLED_PACKAGES.get(spec);
			if (bundled) {
				walk(bundled, [...chain, spec]);
				continue;
			}
			if (!/^[.#]/.test(spec) || (spec.endsWith('.svelte') && !components)) continue;
			const next = resolve(file, spec);
			if (next && !next.startsWith(DEVTOOLS)) walk(next, [...chain, path.relative(SRC, next)]);
		}
	};
	walk(entry, [path.relative(SRC, entry)]);
	return seen;
}

/** The names `files` import from the boot realm's module (`ogygia:boot`), types aside. */
function boot_realm_names(files: Iterable<string>): Set<string> {
	const names = new Set<string>();
	for (const file of files) {
		if (file.endsWith('.svelte')) continue;
		const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
		for (const stmt of sf.statements) {
			if (!ts.isImportDeclaration(stmt)) continue;
			if ((stmt.moduleSpecifier as ts.StringLiteral).text !== 'ogygia:boot') continue;
			const named = stmt.importClause?.namedBindings;
			if (named && ts.isNamedImports(named))
				for (const e of named.elements)
					if (!e.isTypeOnly) names.add((e.propertyName ?? e.name).text);
		}
	}
	return names;
}

/** The boot realm's own modules `files` import by their ids (`ogygia:boot/hooks`), types aside. */
function boot_realm_modules(files: Iterable<string>): Set<string> {
	const ids = new Set<string>();
	for (const file of files) {
		if (file.endsWith('.svelte')) continue;
		const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
		for (const stmt of sf.statements) {
			if (!ts.isImportDeclaration(stmt)) continue;
			if (stmt.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
			const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
			if (spec.startsWith('ogygia:boot/')) ids.add(spec);
		}
	}
	return ids;
}

/** Every chain from `entry` that ends in Svelte. */
function svelte_chains(entry: string): string[] {
	const seen = new Set<string>();
	const found: string[] = [];
	const walk = (file: string, chain: string[]): void => {
		if (seen.has(file)) return;
		seen.add(file);
		const { specs, runes } = scan(file);
		if (runes) found.push([...chain, '(runes → svelte/internal/client)'].join(' > '));
		for (const spec of specs) {
			if (spec === 'svelte' || spec.startsWith('svelte/') || APP_CODE.has(spec)) {
				found.push([...chain, spec].join(' > '));
			} else if (spec.startsWith('.')) {
				if (spec.endsWith('.svelte')) {
					found.push([...chain, spec].join(' > '));
					continue;
				}
				const next = resolve(file, spec);
				if (next && !next.startsWith(DEVTOOLS)) walk(next, [...chain, path.relative(SRC, next)]);
			}
		}
	};
	walk(entry, [path.relative(SRC, entry)]);
	return found;
}

describe('the browser runtime boot never statically reaches Svelte', () => {
	it('core.ts', () => {
		expect(svelte_chains(path.join(RUNTIME, 'core.ts'))).toEqual([]);
	});

	for (const [id, def] of Object.entries(FEATURES)) {
		if ((def.phase ?? 'boot') !== 'boot') continue;
		it(`boot-phase feature "${id}" (${def.module})`, () => {
			const entry = resolve(path.join(RUNTIME, 'x.ts'), `./${def.module}`);
			expect(entry, `feature module ${def.module} resolves`).not.toBeNull();
			expect(svelte_chains(entry!)).toEqual([]);
		});
	}

	it('the walker is not vacuous: the lazy hydrate core DOES reach Svelte', () => {
		expect(svelte_chains(path.join(RUNTIME, 'hydrate-core.ts')).length).toBeGreaterThan(0);
	});
});

// The compiler places each feature in exactly one static phase. A hydrate-phase feature (it reaches
// Svelte) must never be imported by the generated BOOT entry — even when the app uses it — and must
// be imported by the generated hydrate-phase module, sized by the same marks.
describe('the compiler splits features into two static phases', () => {
	const EVERYTHING = {
		complete: true,
		hydrate: ['load', 'interaction', 'none'],
		defer: ['h'],
		router: true,
		live: true,
		wire: true,
		context: true,
		forms: true
	};
	const HYDRATE_PHASE = Object.entries(FEATURES)
		.filter(([, d]) => d.phase === 'hydrate')
		.map(([id]) => id);

	it('hydrate-phase features are exactly context, live, page, wire, remote-seeds', () => {
		expect(HYDRATE_PHASE.sort()).toEqual(['context', 'live', 'page', 'remote-seeds', 'wire']);
	});

	it('the boot entry never imports a hydrate-phase feature, even when the app uses all of them', () => {
		const { code, features } = generateRuntimeEntrySource(EVERYTHING, '/rt');
		for (const id of HYDRATE_PHASE) {
			expect(features).not.toContain(id);
			expect(code).not.toContain(`/rt/${FEATURES[id as keyof typeof FEATURES].module}`);
		}
		expect(features).toContain('router'); // boot-phase ones are still there
	});

	it('the hydrate-phase modules import exactly the hydrate features the marks select', () => {
		const used = generateHydrateFeaturesSource(EVERYTHING, '/rt');
		expect(used.features.sort()).toEqual(['context', 'live', 'page', 'wire']);
		expect(generateRemoteSeedsSource(EVERYTHING, '/rt')).toContain(
			'export * as remote_seeds from "/rt/remote-seeds.js";'
		);
		const plain = generateHydrateFeaturesSource(
			{ complete: true, hydrate: ['load'], remoteSeeds: false, page: false },
			'/rt'
		);
		expect(plain.features).toEqual([]); // a plain app ships none of them
		expect(plain.code).not.toContain('/rt/');
		expect(plain.code).toContain('export const page_on = false;');
		const no_remote = generateRemoteSeedsSource({ complete: true, remoteSeeds: false }, '/rt');
		expect(no_remote).toBe(
			`${dedent`
			export const remote_seeds = null;
			export const remote_seeds_on = false;
		`}\n`
		);
	});
});

// ISLAND-SIDE CODE NEVER IMPORTS A BOOT MODULE. Island code is bundled apart from the runtime (an
// island chunk can load on a csr=true page where the runtime never boots), so a runtime module that
// island code imports is SHARED between the two graphs: the bundler must keep it — and everything
// the runtime's lazy chunks need from it — out of the runtime chunk. One `import … from
// '../runtime/router.js'` in the navigation shim split the boot into a dozen files. Island-side code
// reaches the running runtime through the navigation handle (runtime/nav-handle.ts) instead.
describe('island-side modules reach the runtime only through its handles', () => {
	const boot = new Map<string, string[]>();
	for (const f of static_files(path.join(RUNTIME, 'core.ts'))) boot.set(...f);
	for (const [, def] of Object.entries(FEATURES)) {
		if ((def.phase ?? 'boot') !== 'boot') continue;
		for (const f of static_files(resolve(path.join(RUNTIME, 'x.ts'), `./${def.module}`)!))
			boot.set(...f);
	}
	// The modules island code is aliased to or imports directly (vite/paths.ts APP_SHIMS + the
	// kit-remote client stub, and the public `ogygia/app`).
	const ISLAND_SIDE = [
		'shims/app-navigation.ts',
		'shims/app-state.svelte.ts',
		'shims/app-stores.ts',
		'shims/kit-remote/client-stub.ts',
		'runtime/kit-env.ts',
		'app.ts'
	];
	for (const rel of ISLAND_SIDE) {
		it(`${rel} imports no boot module`, () => {
			const reached = static_files(path.join(SRC, rel));
			const into_boot = [...reached]
				.filter(([f]) => boot.has(f))
				.map(([, chain]) => chain.join(' > '));
			expect(into_boot).toEqual([]);
		});
	}

	// Every island chunk imports `ogygia/internal` and, through it, the region component and its parts.
	// One boot module they reach is shared with the runtime: a file of its own, ahead of the page, on
	// every page (apps/palaestra/e2e/lazy-chunks.spec.ts, the boot-file budget).
	it('island code (ogygia/internal, its components followed) imports no boot module beyond what Kit’s transport shares', () => {
		const into_boot = [...static_files(path.join(SRC, 'internal.ts'), true)]
			.filter(([f]) => boot.has(f) && !kit_transport_shared.has(f))
			.map(([, chain]) => chain.join(' > '));
		expect(into_boot).toEqual([]);
	});

	it('the island walk is not vacuous: it reaches the region component’s parts', () => {
		const reached = static_files(path.join(SRC, 'internal.ts'), true);
		expect(reached.has(path.join(SRC, 'region-parts/head.svelte.ts'))).toBe(true);
	});

	it('the check is not vacuous: the boot set holds the router and the boot link', () => {
		expect(boot.has(path.join(RUNTIME, 'router.ts'))).toBe(true);
		expect(boot.has(path.join(RUNTIME, 'boot-link.ts'))).toBe(true);
	});

	// The boot HANDS its link to each lazy chunk as it imports one (runtime/boot-link.ts `linked`);
	// the lazy realm keeps it (runtime/lazy-link.ts). A boot module that read the lazy link would read
	// a global the boot never filled (no lazy chunk has loaded yet) and bring the holder into the boot.
	it('the boot never reaches the lazy link: it hands the link, it never reads it', () => {
		const lazy_link = path.join(RUNTIME, 'lazy-link.ts');
		expect(boot.get(lazy_link)?.join(' > ')).toBeUndefined();
	});

	it('the lazy check is not vacuous: every lazy chunk reaches the lazy link', () => {
		for (const lazy of ['hydrate-core.ts', 'router-nav.ts', 'interaction-replay.ts'])
			expect(static_files(path.join(RUNTIME, lazy)).has(path.join(RUNTIME, 'lazy-link.ts'))).toBe(
				true
			);
	});

	// THE RUNTIME'S OWN LAZY CHUNKS never import a boot module either — except the few Kit's client
	// transport already shares (the app's `hooks.ts` transport decodes regions on csr=true pages, so
	// those modules are a shared chunk regardless). Kit builds the client with
	// `preserveEntrySignatures: 'strict'`: the runtime chunk may not export a module to a lazy chunk,
	// so every boot module a lazy chunk imports is split into a file of its own — the boot arrived as
	// nine. Lazy chunks get boot helpers handed in (runtime/boot-link.ts `BootLink`).
	const kit_transport_shared = new Set(static_files(path.join(SRC, 'transport.ts')).keys());
	const boot_names = boot_realm_names(boot.keys());
	for (const lazy of ['hydrate-core.ts', 'router-nav.ts', 'interaction-replay.ts']) {
		it(`lazy chunk ${lazy} imports no boot module beyond what Kit's transport shares`, () => {
			const reached = static_files(path.join(RUNTIME, lazy));
			const into_boot = [...reached]
				.filter(([f]) => boot.has(f) && !kit_transport_shared.has(f))
				.map(([, chain]) => chain.join(' > '));
			expect(into_boot).toEqual([]);
		});
	}

	// The build's own words (`ogygia:boot`: the feature word `HAS`, the codec's load) are generated
	// modules, so the walk above never follows them. A lazy chunk that imports a name the boot also
	// imports shares that module with the runtime chunk, and the bundler inlines a shared number into
	// each chunk only while it is three characters or fewer (rolldown: 999 is inlined, 1000 stays a
	// module): a feature word of every feature (8191) would be a file of its own, ahead of the page.
	for (const lazy of ['hydrate-core.ts', 'router-nav.ts', 'interaction-replay.ts']) {
		it(`lazy chunk ${lazy} imports no name of ogygia:boot the boot imports`, () => {
			const shared = [...boot_realm_names(static_files(path.join(RUNTIME, lazy)).keys())].filter(
				(name) => boot_names.has(name)
			);
			expect(shared).toEqual([]);
		});
	}

	// The same for a realm module imported by its own id: one the boot imports too (the hooks it
	// calls, functions) would be shared by the two chunks, a file of its own. A lazy chunk reads its
	// hooks' bits (`ogygia:boot/hook-bits`, which the boot never imports) and the hooks through the link.
	const boot_modules = boot_realm_modules(boot.keys());
	for (const lazy of ['hydrate-core.ts', 'router-nav.ts', 'interaction-replay.ts']) {
		it(`lazy chunk ${lazy} imports no ogygia:boot module the boot imports`, () => {
			const shared = [...boot_realm_modules(static_files(path.join(RUNTIME, lazy)).keys())].filter(
				(id) => boot_modules.has(id)
			);
			expect(shared).toEqual([]);
		});
	}

	it('the module check is not vacuous: the boot calls its hooks, the hydrate core reads their bits', () => {
		expect(boot_modules.has('ogygia:boot/hooks')).toBe(true);
		const hydrate = boot_realm_modules(static_files(path.join(RUNTIME, 'hydrate-core.ts')).keys());
		expect(hydrate.has('ogygia:boot/hook-bits')).toBe(true);
	});

	it('the ogygia:boot check is not vacuous: the boot reads the feature word and its features’ code, the hydrate core its own features', () => {
		expect(boot_names.has('HAS')).toBe(true);
		expect(boot_modules.has('ogygia:boot/feature-code')).toBe(true);
		const hydrate = boot_realm_modules(static_files(path.join(RUNTIME, 'hydrate-core.ts')).keys());
		expect(hydrate.has('ogygia:boot/hydrate-features')).toBe(true);
		expect(hydrate.has('ogygia:boot/remote-seeds')).toBe(true);
	});

	it('Kit’s transport really does share what it lets through (so it is the allowed exception, not a loophole)', () => {
		expect(kit_transport_shared.has(path.join(SRC, 'wire-markup.ts'))).toBe(true);
		expect(boot.has(path.join(SRC, 'wire-markup.ts'))).toBe(true);
		expect(kit_transport_shared.has(path.join(RUNTIME, 'router.ts'))).toBe(false);
	});

	it('the boot set follows the bundled packages too (the machine the boot runs on)', () => {
		expect(boot.has(BUNDLED_PACKAGES.get('@ogygia/machine')!)).toBe(true);
	});
});

// The boot realm (`ogygia:boot`) exists in the browser's runtime build only. The package's entries
// load on the server too (the app's server imports `ogygia`, its hooks, its island code), and the
// build refuses a boot module the server leg imports (virtual_wrong_realm): the whole app fails to
// build. So nothing an entry reaches may import from it; the runtime hands a word in at boot instead.
describe('no package entry reaches the boot realm', () => {
	const ENTRIES = [
		'index.ts',
		'hooks.ts',
		'app.ts',
		'internal.ts',
		'internal-server.ts',
		'internal-instruments.ts',
		'internal-register.ts',
		'internal-reconcile.ts',
		'messages/index.ts',
		'events/index.ts',
		'contract/index.ts'
	];
	const imports_boot_realm = (file: string): boolean => {
		if (file.endsWith('.svelte')) return false;
		return scan(file).specs.some(
			(spec) => spec === 'ogygia:boot' || spec.startsWith('ogygia:boot/')
		);
	};
	for (const entry of ENTRIES) {
		it(`${entry} reaches no module that imports ogygia:boot`, () => {
			const importers = [...static_files(path.join(SRC, entry), true)]
				.filter(([f]) => imports_boot_realm(f))
				.map(([, chain]) => chain.join(' > '));
			expect(importers).toEqual([]);
		});
	}

	it('the check is not vacuous: the region element imports the feature word', () => {
		expect(imports_boot_realm(path.join(RUNTIME, 'core.ts'))).toBe(true);
	});
});
