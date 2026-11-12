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
// ─────────────────────────────────────────────────────────────────────────────
import { brotliCompressSync } from 'node:zlib';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown, type OutputChunk } from 'rolldown';
import type { RuntimeMarks } from '../../../packages/compiler/dist/compiler/link/runtime-entry.js';

/** The value after `flag` on the command line, if any. */
const arg = (flag: string): string | undefined => {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
};

// `--core <dir>`: measure another checkout's built core (CI measures the PR's base this way)
const CORE = arg('--core')
	? resolve(arg('--core')!)
	: fileURLToPath(new URL('../../../packages/core', import.meta.url));
// (a checkout from before @ogygia/compiler has the runtime entry inside core)
const COMPILER_ENTRY = join(CORE, '../compiler/dist/compiler/link/runtime-entry.js');
const { generateRuntimeEntrySource, resolveFeatures } = (await import(
	pathToFileURL(
		existsSync(COMPILER_ENTRY) ? COMPILER_ENTRY : join(CORE, 'dist/compiler/link/runtime-entry.js')
	).href
)) as typeof import('../../../packages/compiler/dist/compiler/link/runtime-entry.js');

const RUNTIME_DIR = join(CORE, 'dist/runtime');
const CORE_VERSION = (
	JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')) as { version: string }
).version;
// Each runtime hook's build constant (on only when a plugin's browser half subscribes), as the plugin
// defines them; a checkout from before the runtime hooks has none.
const HOOKS_FILE = join(CORE, 'dist/contract/runtime-hooks.js');
const HOOK_CONSTANTS: string[] = existsSync(HOOKS_FILE)
	? Object.values(
			((await import(pathToFileURL(HOOKS_FILE).href)) as { RUNTIME_HOOK_CONSTANTS: object })
				.RUNTIME_HOOK_CONSTANTS
		)
	: [];
/** A build constant's name (`__OGYGIA_X__`), as it is left in code when nothing defined it. */
const BUILD_CONSTANT_RE = /\b__OGYGIA_[A-Z0-9_]+__\b/g;
const SNAPSHOT = fileURLToPath(new URL('./bundle-size.snapshot.json', import.meta.url));
// `--compare <json>`: gate against another build's `--json` (the PR's base) instead of the snapshot
const COMPARE = arg('--compare');
/** A profile may grow this much over its baseline before the gate fails: over the snapshot, the
 *  build's own noise; over the base branch's build (same tool, same machine), almost nothing. */
const TOLERANCE = COMPARE ? 0.005 : 0.02;

const update = process.argv.includes('--update');
const asJson = process.argv.includes('--json');

// App profiles → the runtime marks a real app of that shape produces. `wire` + `remote-seeds` are
// always on (props/seeds decode); `forms` is on by default for progressively-enhanced actions.
const PROFILES: Array<{ name: string; blurb: string; marks: RuntimeMarks }> = [
	{
		name: 'Static content',
		blurb: 'load-hydrated islands',
		marks: { complete: true, hydrate: ['load'], forms: false }
	},
	{
		name: 'Interactive',
		blurb: 'interaction-hydrated widgets',
		marks: { complete: true, hydrate: ['interaction'], forms: false }
	},
	{
		name: 'Forms',
		blurb: 'progressively-enhanced actions',
		marks: { complete: true, hydrate: ['load'], forms: true }
	},
	{
		name: 'SPA router',
		blurb: 'client-side navigation',
		marks: { complete: true, hydrate: ['load'], router: true, forms: true }
	},
	{
		name: 'Frozen regions',
		blurb: 'lakes',
		marks: { complete: true, hydrate: ['none'], lakes: true, forms: false }
	},
	{
		name: 'Live regions',
		blurb: 'streaming held regions',
		marks: { complete: true, hydrate: ['load'], live: true, morph: true }
	},
	{
		name: 'Context',
		blurb: 'cross-island Provide / setContext',
		marks: { complete: true, hydrate: ['load'], context: true, forms: false }
	},
	{
		name: 'Everything',
		blurb: 'kitchen sink, with the profiler beacon and a client plugin',
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
	boot: Size;
	total: Size;
	lazy: Array<{ name: string } & Size>;
	/** The boot's modules, by minified length. */
	modules: Record<string, number>;
};
type Snapshot = Record<string, { boot: Size; total: Size }>;

const size = (code: string): Size => {
	const buf = Buffer.from(code);
	return { raw: buf.length, brotli: brotliCompressSync(buf).length };
};

async function measure(
	marks: RuntimeMarks,
	extras: boolean
): Promise<Pick<Row, 'boot' | 'total' | 'lazy' | 'modules'>> {
	const { code } = generateRuntimeEntrySource(marks, RUNTIME_DIR);
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
		external: [/^svelte(\/|$)/, /^\$app\//, /\.svelte$/],
		resolve: { conditionNames: ['browser', 'production', 'import', 'default'] },
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
				// the profiler's browser half and plugin hooks: on only for an app that configured the
				// profiler or devtools, or installs a client plugin (the kitchen-sink profile does)
				__OGYGIA_BEACON__: String(extras),
				__OGYGIA_CLIENT_PLUGINS__: String(extras),
				// the installed version the runtime discloses (`window.__ogygia.v`), as the plugin defines it
				__OGYGIA_VERSION__: JSON.stringify(CORE_VERSION),
				// every hook subscribed in the kitchen sink (the beacon's and a client plugin's), none elsewhere
				...Object.fromEntries(HOOK_CONSTANTS.map((id) => [id, String(extras)]))
			}
		},
		logLevel: 'silent'
	});
	const { output } = await bundle.generate({ format: 'es', minify: true });
	await bundle.close();
	const chunks = output.filter((o): o is OutputChunk => o.type === 'chunk');
	// every build constant is defined, as the plugin's build defines it: one left undefined keeps its
	// default branch (on) and the bytes behind it, a size no real build ships
	const undefined_constants = new Set(
		chunks.flatMap((c) => [...c.code.matchAll(BUILD_CONSTANT_RE)].map((m) => m[0]))
	);
	if (undefined_constants.size)
		throw new Error(
			`bundle-size: build constants left undefined (define them as the plugin does): ${[...undefined_constants].join(', ')}`
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
	const boot = size(
		chunks
			.filter((c) => boot_set.has(c.fileName))
			.map((c) => c.code)
			.join('\n')
	);
	const total = size(chunks.map((c) => c.code).join('\n'));
	const lazy = chunks
		.filter((c) => !boot_set.has(c.fileName))
		.map((c) => ({ name: c.name, ...size(c.code) }));
	// each module of the boot, by its minified length (`--modules`): what to look at first
	const modules: Record<string, number> = {};
	for (const c of chunks)
		if (boot_set.has(c.fileName))
			for (const [id, m] of Object.entries(c.modules))
				if (m.renderedLength > 0) modules[module_name(id)] = m.renderedLength;
	return { boot, total, lazy, modules };
}

/** A module's id, short: its path from the repo's packages (or its package in node_modules). */
function module_name(id: string): string {
	const at = id.lastIndexOf('/node_modules/');
	if (at !== -1) return id.slice(at + '/node_modules/'.length);
	const pkg = id.indexOf('/packages/');
	return pkg === -1 ? id : id.slice(pkg + 1);
}

const rows: Row[] = [];
for (const p of PROFILES) {
	const m = await measure(p.marks, p.name === 'Everything');
	rows.push({ name: p.name, blurb: p.blurb, features: resolveFeatures(p.marks), ...m });
}

if (update) {
	const snap: Snapshot = Object.fromEntries(
		rows.map((r) => [r.name, { boot: r.boot, total: r.total }])
	);
	writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2) + '\n');
	console.log(`✓ baseline snapshot written → apps/palaestra/e2e/bundle-size.snapshot.json`);
}

if (asJson) {
	console.log(JSON.stringify(rows, null, 2));
	process.exit(0);
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
const kb = (n: number) => (n / 1024).toFixed(2) + ' kB';
const delta = (cur: number, prev?: number) => {
	if (prev == null) return '—';
	const d = cur - prev;
	if (d === 0) return '±0';
	return (d > 0 ? '+' : '') + (d / 1024).toFixed(2) + ' kB';
};

console.log(`\nogygia runtime (brotli) — isolated rolldown build, svelte externalized\n`);
console.log(
	'  ' +
		'profile'.padEnd(16) +
		'boot'.padEnd(11) +
		'Δ'.padEnd(11) +
		'total'.padEnd(11) +
		'Δ'.padEnd(11) +
		'lazy chunks'
);
console.log('  ' + '─'.repeat(84));
const failures: string[] = [];
for (const r of rows) {
	const prev = baseline(r.name);
	console.log(
		'  ' +
			r.name.padEnd(16) +
			kb(r.boot.brotli).padEnd(11) +
			delta(r.boot.brotli, prev?.boot.brotli).padEnd(11) +
			kb(r.total.brotli).padEnd(11) +
			delta(r.total.brotli, prev?.total.brotli).padEnd(11) +
			r.lazy.map((l) => `${l.name} ${kb(l.brotli)}`).join(', ')
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
console.log('  ' + '─'.repeat(84));
console.log('  ' + 'average boot'.padEnd(16) + kb(avg));
console.log('');
if (failures.length) {
	if (COMPARE) {
		console.error('✗ bundle-size growth over the base branch:\n  ' + failures.join('\n  '));
		console.error(
			'  If the growth is meant, the PR body says why on a line of its own: `Size baseline: <why>`.'
		);
	} else {
		console.error('✗ bundle-size regression (over snapshot + 2 %):\n  ' + failures.join('\n  '));
		console.error('  If the growth is intended, refresh the baseline: pnpm bundle-size --update');
	}
	process.exit(1);
}
