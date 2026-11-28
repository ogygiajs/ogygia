#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ogygia — runtime bundle-size measurement AND regression gate.
//
// Measures the client runtime cost per app profile the RIGHT way: an ISOLATED rolldown build of the
// feature-selected runtime entry (no app code, svelte externalized since Kit ships it anyway), so
// numbers are comparable across profiles instead of being scattered by per-app code-splitting.
//
// Two numbers per profile, both brotli:
//   • BOOT  — the entry chunk: what every page of that profile downloads to boot the runtime.
//   • TOTAL — the entry plus the lazy chunks (`hydrate-core` on the first island wake, `router-nav`
//             on the first prefetch/click, `interaction-replay` on the first arm): the most a page
//             can ever pull from the runtime.
// Either growing past the committed snapshot by more than 2 % FAILS the run (exit 1) — a size
// regression is a test failure, not a printed delta. Regenerate the snapshot on purpose, with
// `--update`, after a change that is meant to move the numbers.
//
//   pnpm bundle-size                   # measure + gate against the snapshot
//   pnpm bundle-size --update          # rewrite the baseline snapshot
//   pnpm bundle-size --json            # machine-readable output (for the docs page)
//   pnpm bundle-size --out <dir>       # also write each profile's chunks and sourcemaps
// ─────────────────────────────────────────────────────────────────────────────
import { brotliCompressSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown, type OutputChunk, type Plugin } from 'rolldown';
import { dedent } from 'ogygia/plugin/utils';
import type { RuntimeMarks } from '../../../packages/compiler/dist/link/runtime-entry.js';
import type { ClientRealmFile } from '../../../packages/compiler/dist/link/caps.js';
import { PROGRAMS } from './_programs.ts';
import { mapped_text } from './_sourcemap.ts';

/** The value after `flag` on the command line, if any. */
const arg = (flag: string): string | undefined => {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
};

// `--core <dir>`: measure another checkout's built core (CI measures the PR's base this way)
const CORE = arg('--core')
	? resolve(arg('--core')!)
	: fileURLToPath(new URL('../../../packages/core', import.meta.url));
// (an older checkout keeps it under the compiler's dist/compiler/, or inside core before @ogygia/compiler)
const COMPILER_ENTRY = [
	join(CORE, '../compiler/dist/link/runtime-entry.js'),
	join(CORE, '../compiler/dist/compiler/link/runtime-entry.js')
].find((p) => existsSync(p));
const {
	generateRuntimeEntrySource,
	generateRuntimeFlagsSource,
	generateHydrateFeaturesSource,
	generateFeatureCodeSource,
	generateRemoteSeedsSource,
	resolveFeatures
} = (await import(
	pathToFileURL(COMPILER_ENTRY ?? join(CORE, 'dist/compiler/link/runtime-entry.js')).href
)) as typeof import('../../../packages/compiler/dist/link/runtime-entry.js');

// The hooks each client realm subscribes to, read from its file as the plugin reads it (an older
// checkout's compiler, without client realms, has none)
const PLUGIN_API = join(CORE, '../compiler/dist/vite/plugin-api.js');
const client_hook_names: ((plugin: string, file: string) => string[]) | null = existsSync(
	PLUGIN_API
)
	? ((
			(await import(pathToFileURL(PLUGIN_API).href)) as {
				client_hook_names?: typeof client_hook_names;
			}
		).client_hook_names ?? null)
	: null;

// The generators of the hooks module and the lazy chunks' bits (a checkout that folds its hooks by
// defines has none)
const HOOKS_GEN = join(CORE, '../compiler/dist/link/hooks.js');
const hooks_gen = existsSync(HOOKS_GEN)
	? ((await import(
			pathToFileURL(HOOKS_GEN).href
		)) as typeof import('../../../packages/compiler/dist/link/hooks.js'))
	: null;

const RUNTIME_DIR = join(CORE, 'dist/runtime');
const CORE_VERSION = (
	JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')) as { version: string }
).version;
// The runtime hooks, and (a checkout that folds them by defines) each one's build constant, on only
// when a client realm subscribes, as the plugin defines them; a checkout from before the runtime
// hooks has none.
const HOOKS_FILE = join(CORE, 'dist/contract/runtime-hooks.js');
const hooks_contract = (
	existsSync(HOOKS_FILE) ? await import(pathToFileURL(HOOKS_FILE).href) : {}
) as { RUNTIME_HOOK_CONSTANTS?: Record<string, string>; RUNTIME_HOOK_NAMES?: readonly string[] };
const HOOK_CONSTANTS: Record<string, string> = hooks_contract.RUNTIME_HOOK_CONSTANTS ?? {};
const HOOK_NAMES: readonly string[] =
	hooks_contract.RUNTIME_HOOK_NAMES ?? Object.keys(HOOK_CONSTANTS);
// @ogygia/rewrite's browser realm, as an app installs it (its build)
const REWRITE_CLIENT = join(CORE, '../rewrite/dist/client.js');
// A client realm that subscribes to every hook, each a call the bundler cannot drop: the kitchen
// sink's plugin, the most hook code a boot can carry
const EVERY_HOOK_CLIENT = join(mkdtempSync(join(tmpdir(), 'ogygia-size-client-')), 'client.mjs');
writeFileSync(
	EVERY_HOOK_CLIENT,
	`export default { hooks: { ${HOOK_NAMES.map((h) => `${h}: (e) => globalThis.__og_size?.(e)`).join(', ')} } };\n`
);
/** A build constant's name (`__OGYGIA_X__`), as it is left in code when nothing defined it. */
const BUILD_CONSTANT_RE = /\b__OGYGIA_[A-Z0-9_]+__\b/g;
/** The boot realm's virtual module (`ogygia:boot`, `ogygia:boot/…`), as an import a chunk kept.
 *  (`ogygia:region` is the app's transport, the app's own code: external, like svelte.) */
const VIRTUAL_ID_RE = /^ogygia:boot(\/|$)/;
/** A generated module's `export const <name>`. */
const EXPORTED_CONST_RE = /^export const (\w+)/gm;
/** A sourcemap source's leading `../` steps (the path is relative to the chunk). */
const SOURCE_UP_RE = /^(\.\.\/)+/;
const SNAPSHOT = fileURLToPath(new URL('./bundle-size.snapshot.json', import.meta.url));
// `--compare <json>`: gate against another build's `--json` (the PR's base) instead of the snapshot
const COMPARE = arg('--compare');
// `--out <dir>`: write each profile's chunks with their sourcemaps (<dir>/<profile>/), to attribute
// the bytes to the modules they came from
const OUT = arg('--out');
/** A profile may grow this much over its baseline before the gate fails: over the snapshot, the
 *  build's own noise; over the base branch's build (same tool, same machine), almost nothing. */
const TOLERANCE = COMPARE ? 0.005 : 0.02;
/** A string only the router's navigation carries in a lazy chunk: its view transition. */
const ROUTER_NAVIGATION_MARKER = 'startViewTransition';

const update = process.argv.includes('--update');
const asJson = process.argv.includes('--json');

// App profiles → the runtime marks a real app of that shape produces. `wire` + `remote-seeds` are
// always on (props/seeds decode); `forms` is on by default for progressively-enhanced actions.
// `budget`: the most the profile's boot may weigh, brotli bytes, in every mode but `--core`: a
// ceiling of its own, whatever the base branch weighs (raise it on purpose, with the PR's
// `Size baseline:` line). `kit`: the app has pages Kit hydrates (`__OGYGIA_KIT_PAGES__`, compiler
// kit.ts `kit_may_hydrate`); every other profile's routes are all csr=false, the plain ogygia app.
const PROFILES: Array<{
	name: string;
	blurb: string;
	marks: RuntimeMarks;
	budget: number;
	kit?: boolean;
	/** Its plugins' browser realms (files), in plugin order. */
	clients?: string[];
}> = [
	{
		name: 'Static content',
		blurb: 'load-hydrated islands',
		marks: { complete: true, hydrate: ['load'], forms: false },
		budget: 25_100
	},
	{
		name: 'Interactive',
		blurb: 'interaction-hydrated widgets',
		marks: { complete: true, hydrate: ['interaction'], forms: false },
		budget: 25_100
	},
	{
		name: 'Forms',
		blurb: 'progressively-enhanced actions',
		marks: { complete: true, hydrate: ['load'], forms: true },
		budget: 25_600
	},
	{
		name: 'SPA router',
		blurb: 'client-side navigation',
		marks: { complete: true, hydrate: ['load'], router: true, forms: true },
		budget: 30_900
	},
	{
		name: 'Deferred regions',
		blurb: 'server-rendered holes',
		marks: { complete: true, hydrate: ['load'], defer: ['load'], forms: false },
		budget: 33_200
	},
	{
		name: 'Frozen regions',
		blurb: 'lakes',
		marks: { complete: true, hydrate: ['none'], lakes: true, forms: false },
		budget: 31_200
	},
	{
		name: 'Live regions',
		blurb: 'streaming held regions',
		marks: { complete: true, hydrate: ['load'], live: true, morph: true },
		budget: 34_000
	},
	{
		name: 'Context',
		blurb: 'cross-island Provide / setContext',
		marks: { complete: true, hydrate: ['load'], context: true, forms: false },
		budget: 25_100
	},
	{
		name: 'Rewrite',
		blurb: 'load-hydrated islands, with @ogygia/rewrite',
		marks: { complete: true, hydrate: ['load'], forms: false },
		budget: 24_700,
		clients: [REWRITE_CLIENT]
	},
	{
		name: 'Everything',
		blurb: 'kitchen sink, with the profiler beacon and a client plugin',
		budget: 39_700,
		kit: true,
		clients: [EVERY_HOOK_CLIENT],
		marks: {
			complete: true,
			hydrate: ['load', 'interaction', 'none'],
			defer: ['load'],
			router: true,
			live: true,
			morph: true,
			lakes: true,
			persist: true,
			persistKeys: ['x'],
			forms: true,
			wire: true,
			remoteSeeds: true,
			context: true
		}
	}
];

type Size = { raw: number; brotli: number };
type Row = {
	name: string;
	blurb: string;
	features: string[];
	/** It has pages Kit hydrates. */
	kit: boolean;
	/** Its plugins' browser realms (files). */
	clients: string[];
	boot: Size;
	total: Size;
	lazy: Array<{ name: string } & Size>;
	/** The boot's modules, by minified length. */
	modules: Record<string, number>;
	/** The lazy chunks' modules. */
	lazy_modules: string[];
};
type Snapshot = Record<string, { boot: Size; total: Size }>;

const size = (code: string): Size => {
	const buf = Buffer.from(code);
	return { raw: buf.length, brotli: brotliCompressSync(buf).length };
};

/** The boot realm's virtual module, `ogygia:boot`, served from the profile's marks as the plugin
 *  serves an app build's (the runtime flags, the hydrate-phase features; no region names). An older
 *  checkout's compiler without the generators leaves it external, as that build's own tool did. */
function boot_realm(marks: RuntimeMarks, realms: readonly ClientRealmFile[]): Plugin {
	// (one named re-export per name, as the plugin's realm module is: virtual/resolver.ts)
	const flags = () => generateRuntimeFlagsSource(marks, RUNTIME_DIR);
	const names = (source: string) =>
		[...source.matchAll(EXPORTED_CONST_RE)].map((m) => m[1]).join(', ');
	// (a checkout that folds its hooks by a module: the hooks the realms subscribe to, and the
	// lazy chunks' bits, as the plugin serves them)
	const hooks = () => hooks_gen?.generateHooksSource(realms, RUNTIME_DIR) ?? '';
	const bits = () => hooks_gen?.generateHookBitsSource(realms) ?? '';
	const hydrate = () => generateHydrateFeaturesSource(marks, RUNTIME_DIR).code;
	// (a checkout whose hydrate core installs its features through the realm module's re-export)
	const installs = () =>
		hydrate().includes('export function install')
			? "export { install as install_hydrate_features } from 'ogygia:boot/hydrate-features';"
			: '';
	const ids: Record<string, () => string> = {
		'ogygia:boot': () => dedent`
			export { ${names(flags())} } from 'ogygia:boot/runtime-flags';
			${installs()}
			export const region_names = {};
		`,
		'ogygia:boot/runtime-flags': flags,
		'ogygia:boot/hydrate-features': hydrate,
		// (a checkout whose page feature reads its remote seeds by a module of their own)
		'ogygia:boot/remote-seeds': () => generateRemoteSeedsSource?.(marks, RUNTIME_DIR) ?? '',
		'ogygia:boot/hooks': hooks,
		'ogygia:boot/hook-bits': bits,
		// (a checkout whose element calls its features' modules directly)
		'ogygia:boot/feature-code': () => generateFeatureCodeSource?.(marks, RUNTIME_DIR) ?? ''
	};
	const served = typeof generateRuntimeFlagsSource === 'function';
	return {
		name: 'ogygia-size:boot-realm',
		resolveId: (id) => (served && id in ids ? `\0${id}` : null),
		load: (id) => (id.startsWith('\0') ? (ids[id.slice(1)]?.() ?? null) : null)
	};
}

async function measure(
	marks: RuntimeMarks,
	extras: boolean,
	clients: readonly string[],
	kit: boolean,
	profile: string
): Promise<
	Pick<Row, 'boot' | 'total' | 'lazy' | 'modules' | 'lazy_modules'> & {
		boot_code: string;
		lazy_code: string;
	}
> {
	const realms: ClientRealmFile[] = clients.map((module, i) => {
		const name = `size-client-${i}`;
		const hooks = (client_hook_names?.(name, module) ?? HOOK_NAMES) as ClientRealmFile['hooks'];
		return { name, module, hooks };
	});
	const subscribed = new Set(realms.flatMap((r) => r.hooks));
	const { code } = generateRuntimeEntrySource(marks, RUNTIME_DIR, realms);
	const dir = mkdtempSync(join(tmpdir(), 'ogygia-size-'));
	const entry = join(dir, 'entry.mjs');
	writeFileSync(entry, code);
	// Bundle everything ogygia owns (core, features, devalue); externalize what the host app already
	// ships (svelte, Kit's $app) so we measure ogygia's MARGINAL cost, not shared runtime. esm-env is
	// bundled as a production browser build resolves it (its `DEV` false, `BROWSER` true: a few
	// bytes), so what it gates folds as it does in an app: the message tables of a production browser
	// bundle (they print the code's link alone) are not shipped, and not counted.
	const bundle = await rolldown({
		input: entry,
		external: [/^svelte(\/|$)/, /^\$app\//, /\.svelte$/, /^ogygia:region(\/|$)/],
		resolve: { conditionNames: ['browser', 'production', 'import', 'default'] },
		plugins: [boot_realm(marks, realms)],
		// Strip DEV like a real Vite prod build (import.meta.env.DEV → false), so the numbers reflect
		// what actually ships — not the dev-only warnings and the PropMutationGuard, which prod DCEs.
		// Mirror the plugin's `define` (vite/index.ts) at their prod defaults: the runtime's build-time
		// gates are `typeof __X__ !== 'undefined' ? __X__ : default`, which only fold when the toolchain
		// replaces the global. This isolated rolldown build bypasses the plugin, so define them here or
		// the devtools graph (and the server-delta branch) can't tree-shake — a false +4 kB per profile.
		transform: {
			define: {
				'import.meta.env.DEV': 'false',
				'import.meta.env.MODE': '"production"',
				__OGYGIA_DEVTOOLS__: 'false', // off by default — user apps never ship it
				__OGYGIA_RULES__: 'false', // ogygia's rules on itself: dev and e2e builds only, never shipped
				__OGYGIA_CONTINUITY_FORMS__: 'true', // form continuity on by default (gated by the profile's marks)
				__OGYGIA_SERVER_DELTA__: 'false', // server-delta nav is opt-in
				__OGYGIA_KIT_PAGES__: String(kit), // the app has pages Kit hydrates (the kitchen sink)
				__OGYGIA_KIT_MAJOR__: '2',
				// the profiler's browser half and plugin hooks: on only for an app that configured the
				// profiler or devtools, or installs a client plugin (the kitchen-sink profile does)
				__OGYGIA_BEACON__: String(extras),
				__OGYGIA_CLIENT_PLUGINS__: String(realms.length > 0),
				// the installed version the runtime discloses (`window.__ogygia.v`), as the plugin defines it
				__OGYGIA_VERSION__: JSON.stringify(CORE_VERSION),
				// each hook its client realms subscribe to (a checkout that folds hooks by defines)
				...Object.fromEntries(
					Object.entries(HOOK_CONSTANTS).map(([h, id]) => [
						id,
						String(subscribed.has(h as ClientRealmFile['hooks'][number]))
					])
				)
			}
		},
		logLevel: 'silent'
	});
	const { output } = await bundle.generate({ format: 'es', minify: true, sourcemap: 'hidden' });
	await bundle.close();
	const chunks = output.filter((o): o is OutputChunk => o.type === 'chunk');
	if (OUT) {
		const at = join(OUT, profile.replaceAll(' ', '_'));
		mkdirSync(at, { recursive: true });
		for (const c of chunks) {
			writeFileSync(join(at, c.fileName), c.code);
			if (c.map) writeFileSync(join(at, `${c.fileName}.map`), c.map.toString());
		}
	}
	// every build constant is defined, as the plugin's build defines it: one left undefined keeps its
	// default branch (on) and the bytes behind it, a size no real build ships
	const undefined_constants = new Set(
		chunks.flatMap((c) => [...c.code.matchAll(BUILD_CONSTANT_RE)].map((m) => m[0]))
	);
	if (undefined_constants.size)
		throw new Error(
			`bundle-size: build constants left undefined (define them as the plugin does): ${[...undefined_constants].join(', ')}`
		);
	// every virtual module is the build's own, as the plugin serves it: one left external keeps
	// what its flags would fold (`FRAMES` off still ships the frame path), a size no real build ships
	const unresolved_virtuals = new Set(
		chunks.flatMap((c) => c.imports.filter((id) => VIRTUAL_ID_RE.test(id)))
	);
	if (unresolved_virtuals.size && typeof generateRuntimeFlagsSource === 'function')
		throw new Error(
			`bundle-size: virtual modules left unresolved (serve them as the plugin does): ${[...unresolved_virtuals].join(', ')}`
		);
	// BOOT is the entry chunk plus everything it imports STATICALLY (a module the entry shares with
	// a lazy chunk lands in a shared chunk the entry still loads at boot); the rest is lazy.
	const by_name = new Map(chunks.map((c) => [c.fileName, c]));
	const boot_set = new Set<string>();
	const walk = (name: string) => {
		if (boot_set.has(name)) return;
		boot_set.add(name);
		for (const dep of by_name.get(name)?.imports ?? []) walk(dep);
	};
	for (const c of chunks) if (c.isEntry) walk(c.fileName);
	const boot_code = chunks
		.filter((c) => boot_set.has(c.fileName))
		.map((c) => c.code)
		.join('\n');
	const boot = size(boot_code);
	const total = size(chunks.map((c) => c.code).join('\n'));
	const lazy = chunks
		.filter((c) => !boot_set.has(c.fileName))
		.map((c) => ({ name: c.name, ...size(c.code) }));
	// each module of the boot, by its minified length: what to look at first. Read off the
	// sourcemap, after minify: a module's rendered length is measured before it, and counts a module
	// the minifier then drops whole (every call to it behind a flag that folded off).
	const modules: Record<string, number> = {};
	const lazy_modules: string[] = [];
	for (const c of chunks)
		for (const [id, bytes] of minified_lengths(c))
			if (boot_set.has(c.fileName)) modules[module_name(id)] = bytes;
			else lazy_modules.push(module_name(id));
	const lazy_code = chunks
		.filter((c) => !boot_set.has(c.fileName))
		.map((c) => c.code)
		.join('\n');
	return { boot, total, lazy, modules, lazy_modules, boot_code, lazy_code };
}

/** The minified bytes of `chunk` each source module wrote, by its sourcemap. */
function minified_lengths(chunk: OutputChunk): Map<string, number> {
	const map = chunk.map;
	// (rolldown's own helpers, a namespace object's maker, come in a chunk of their own with no source)
	if (!map && chunk.fileName.startsWith('rolldown-runtime'))
		return new Map([['rolldown:runtime', Buffer.byteLength(chunk.code)]]);
	if (!map) throw new Error(`bundle-size: no sourcemap for ${chunk.fileName}`);
	const out = new Map<string, number>();
	for (const [id, text] of mapped_text(chunk.code, map)) out.set(id, Buffer.byteLength(text));
	// (sources are written relative to the chunk; the module ids rolldown names are absolute)
	const by_id = new Map<string, number>();
	for (const id of Object.keys(chunk.modules)) {
		const bytes = out.get(map.sources.find((s) => id.endsWith(s.replace(SOURCE_UP_RE, ''))) ?? '');
		if (bytes) by_id.set(id, bytes);
	}
	return by_id;
}

/** A module's id, short: its path from the repo's packages (or its package in node_modules). */
function module_name(id: string): string {
	const at = id.lastIndexOf('/node_modules/');
	if (at !== -1) return id.slice(at + '/node_modules/'.length);
	const pkg = id.indexOf('/packages/');
	return pkg === -1 ? id : id.slice(pkg + 1);
}

const rows: Row[] = [];
/** Each profile's boot code, by its name (for the leak gate's strings). */
const boot_codes = new Map<string, string>();
/** Each profile's lazy chunks' code, by its name (for the lazy gate's strings). */
const lazy_codes = new Map<string, string>();
for (const p of PROFILES) {
	const kit = p.kit === true;
	const { boot_code, lazy_code, ...m } = await measure(
		p.marks,
		p.name === 'Everything',
		p.clients ?? [],
		kit,
		p.name
	);
	boot_codes.set(p.name, boot_code);
	lazy_codes.set(p.name, lazy_code);
	rows.push({
		name: p.name,
		blurb: p.blurb,
		features: resolveFeatures(p.marks),
		kit,
		clients: p.clients ?? [],
		...m
	});
}

// The leak gate (PROGRAMS), on this checkout's runtime; another checkout's (`--core`, the base
// branch CI measures) is only measured.
if (!arg('--core')) {
	const leaks: string[] = [];
	for (const r of rows)
		for (const p of PROGRAMS) {
			const needs = p.feature === null ? [] : [p.feature].flat();
			const held = p.client
				? r.clients.some((c) => c.endsWith(p.client!))
				: p.kit
					? r.kit
					: needs.length > 0 && needs.every((f) => r.features.includes(f));
			const selects = p.client ? p.client : p.kit ? 'Kit pages' : needs.join(' + ');
			for (const mod of p.modules) {
				if (p.phase === 'hydrate') {
					if (mod in r.modules)
						leaks.push(`${r.name}: its boot holds ${mod} (${p.name}), a hydrate-phase program`);
					else if (held !== r.lazy_modules.includes(mod))
						leaks.push(
							held
								? `${r.name}: selects ${selects}, but no lazy chunk holds ${mod} (${p.name})`
								: `${r.name}: a lazy chunk holds ${mod} (${p.name}), which its marks never run`
						);
					continue;
				}
				if (held && !(mod in r.modules))
					leaks.push(`${r.name}: selects ${selects}, but its boot lacks ${mod} (${p.name})`);
				else if (!held && mod in r.modules)
					leaks.push(`${r.name}: its boot holds ${mod} (${p.name}), which its marks never run`);
				else if (p.feature === null && !p.client && !r.lazy_modules.includes(mod))
					leaks.push(`${r.name}: no lazy chunk holds ${mod} (${p.name})`);
			}
			const code = boot_codes.get(r.name) ?? '';
			for (const text of p.strings ?? []) {
				if (held && !code.includes(text))
					leaks.push(`${r.name}: selects ${selects}, but its boot lacks ${p.name}`);
				else if (!held && code.includes(text))
					leaks.push(`${r.name}: its boot holds ${p.name} ('${text}'), which its marks never run`);
			}
		}
	// The navigation chunk without the router is the soft refresh alone: the boot that imports it for
	// a refresh names what it uses, so the router's navigation (its view transition) is left out.
	for (const r of rows) {
		const navigates = (lazy_codes.get(r.name) ?? '').includes(ROUTER_NAVIGATION_MARKER);
		if (r.features.includes('router') !== navigates)
			leaks.push(
				navigates
					? `${r.name}: a lazy chunk holds the router's navigation, which its marks never run`
					: `${r.name}: selects router, but no lazy chunk holds its navigation`
			);
	}
	for (const p of PROFILES) {
		const r = rows.find((row) => row.name === p.name)!;
		if (r.boot.brotli > p.budget)
			leaks.push(
				`${r.name}: its boot weighs ${r.boot.brotli} B brotli, over its budget ${p.budget}`
			);
	}
	if (leaks.length) {
		console.error(
			`✗ bundle-size: a program in the wrong boot, or a boot over budget:\n  ${leaks.join('\n  ')}`
		);
		// (`--json` still writes the numbers; the run fails after)
		process.exitCode = 1;
		if (!asJson) process.exit(1);
	}
}

if (update) {
	const snap: Snapshot = Object.fromEntries(
		rows.map((r) => [r.name, { boot: r.boot, total: r.total }])
	);
	writeFileSync(SNAPSHOT, `${JSON.stringify(snap, null, 2)}\n`);
	console.log(`✓ baseline snapshot written → apps/palaestra/e2e/bundle-size.snapshot.json`);
}

if (asJson) {
	console.log(JSON.stringify(rows, null, 2));
	process.exit();
}

const base: Snapshot = COMPARE
	? Object.fromEntries(
			(JSON.parse(readFileSync(COMPARE, 'utf8')) as Row[]).map((r) => [
				r.name,
				{ boot: r.boot, total: r.total }
			])
		)
	: existsSync(SNAPSHOT)
		? JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
		: {};
/** A profile's baseline, or undefined when the snapshot predates the boot/total split. */
const baseline = (name: string) => (base[name]?.boot && base[name]?.total ? base[name] : undefined);
const kb = (n: number) => `${(n / 1024).toFixed(2)} kB`;
const delta = (cur: number, prev?: number) => {
	if (prev == null) return '—';
	const d = cur - prev;
	if (d === 0) return '±0';
	return `${(d > 0 ? '+' : '') + (d / 1024).toFixed(2)} kB`;
};

console.log(`\nogygia runtime (brotli) — isolated rolldown build, svelte externalized\n`);
console.log(
	`  ${'profile'.padEnd(16)}${'boot'.padEnd(11)}${'Δ'.padEnd(11)}${'total'.padEnd(11)}${'Δ'.padEnd(11)}lazy chunks`
);
console.log(`  ${'─'.repeat(84)}`);
const failures: string[] = [];
for (const r of rows) {
	const prev = baseline(r.name);
	console.log(
		`  ${r.name.padEnd(16)}${kb(r.boot.brotli).padEnd(11)}${delta(r.boot.brotli, prev?.boot.brotli).padEnd(11)}${kb(r.total.brotli).padEnd(11)}${delta(r.total.brotli, prev?.total.brotli).padEnd(11)}${r.lazy.map((l) => `${l.name} ${kb(l.brotli)}`).join(', ')}`
	);
	if (!prev || update) continue;
	for (const key of ['boot', 'total'] as const) {
		const limit = Math.ceil(prev[key].brotli * (1 + TOLERANCE));
		if (r[key].brotli > limit)
			failures.push(
				`${r.name} ${key}: ${kb(r[key].brotli)} > ${kb(limit)} (${COMPARE ? 'base' : 'snapshot'} ${kb(prev[key].brotli)} + ${TOLERANCE * 100} %)`
			);
	}
}
const avg = Math.round(rows.reduce((a, r) => a + r.boot.brotli, 0) / rows.length);
console.log(`  ${'─'.repeat(84)}`);
console.log(`  ${'average boot'.padEnd(16)}${kb(avg)}`);
console.log('');
if (failures.length) {
	if (COMPARE) {
		console.error(`✗ bundle-size growth over the base branch:\n  ${failures.join('\n  ')}`);
		console.error(
			'  If the growth is meant, the PR body says why on a line of its own: `Size baseline: <why>`.'
		);
	} else {
		console.error(`✗ bundle-size regression (over snapshot + 2 %):\n  ${failures.join('\n  ')}`);
		console.error('  If the growth is intended, refresh the baseline: pnpm bundle-size --update');
	}
	process.exit(1);
}
