// The barrel rewrite per importer, the work a build does for every project module: the plugin's own
// transform at ogygia's source stage over a module and a component that import through nested
// barrels (some names placed, some left, one import pinned), a component that cannot be parsed, and
// the end-of-build report over many barrels.
import path from 'node:path';
import MagicString from 'magic-string';
import { bench } from '@bench/heisenbench/bench';
import { ExportIndex, Shapes } from '@ogygia/core/internal/compiler';
import type { BuildContext, PluginDefinition, StageTransform } from '@ogygia/core/vite';
import { barrels } from '../src/index.ts';
import { BARRELS_WARNINGS } from '../src/messages.ts';
import { format_report, fresh_report } from '../src/report.ts';

/** `n` barrels of four leaves each under one top barrel, a module and a component that import from
 *  them, and a component the parser rejects, as in-memory files. */
function app(n: number) {
	const files = new Map<string, string>();
	for (let b = 0; b < n; b++) {
		for (let l = 0; l < 4; l++) files.set(`/app/lib/b${b}/L${l}.svelte`, `<p>${b}.${l}</p>`);
		files.set(
			`/app/lib/b${b}/index.ts`,
			Array.from(
				{ length: 4 },
				(_, l) => `export { default as C${b}_${l} } from './L${l}.svelte';`
			).join('\n') + `\nexport type T${b} = number;`
		);
	}
	files.set(
		'/app/lib/index.ts',
		Array.from({ length: n }, (_, b) => `export * from './b${b}';`).join('\n')
	);
	files.set('/app/lib/own.ts', `export * from './b0';\nexport const side = globalThis.x = 1;`);
	const names = Array.from({ length: n }, (_, b) => `C${b}_${b % 4}`);
	files.set(
		'/app/src/main.ts',
		`import { ${names.join(', ')}, nope } from '$lib';\nimport { C0_1 } from '$lib' with { wake: 'load' };\nimport { side } from '$lib/own';\nimport type { T0 } from '$lib';\nimport * as all from '$lib';\nconsole.log(${names.join(', ')}, C0_1, side, all);`
	);
	files.set(
		'/app/src/App.svelte',
		`<script module lang="ts">\n\timport { C0_0 } from '$lib';\n</script>\n<script lang="ts">\n\timport { ${names.join(', ')} } from '$lib';\n</script>\n<C0_0 />\n<style>\n\tp { color: red }\n</style>`
	);
	files.set('/app/src/Broken.svelte', `<script>import { C0_0 } from '$lib';\n<div>`);
	const read = (id: string): string | null => files.get(id) ?? null;
	const resolve = async (spec: string, importer: string): Promise<string | null> => {
		const base = spec.startsWith('$lib')
			? '/app/lib' + spec.slice(4)
			: path.posix.join(path.posix.dirname(importer), spec);
		for (const id of [base, `${base}.ts`, `${base}/index.ts`]) if (files.has(id)) return id;
		return null;
	};
	return { files, read, resolve };
}

/** The plugin's source-stage transform as ogygia hands it its seams, over one shared index. */
function plugin_over(a: ReturnType<typeof app>, options: Parameters<typeof barrels>[0]) {
	const [definition, report] = barrels(options);
	const index = new ExportIndex<void>((s, importer) => a.resolve(s, importer), new Shapes(a.read));
	let stage: StageTransform | null = null;
	const b = {
		root: '/app',
		dev: false,
		transform: (s: StageTransform) => void (stage = s),
		exports: { map: (file, spec, policy) => index.map(file, spec, policy) },
		pinnedImports: () => (decl) => decl.attribute_keys.includes('wake')
	} as Partial<BuildContext> as BuildContext;
	// (the definition sits under core's registered symbol, as ogygia() finds it)
	(definition as unknown as Record<symbol, PluginDefinition>)[Symbol.for('ogygia.plugin')].build!(
		b
	);
	const lines: string[] = [];
	(report.configResolved as (c: unknown) => void)({
		root: '/app',
		command: 'build',
		logger: { info: (m: string) => void lines.push(m) }
	});
	return { stage: stage!, report, lines };
}

bench(
	'barrels: a module and a component rewritten through nested barrels, one component skipped, the report',
	async ({ a }) => {
		const quiet = console.warn;
		console.warn = () => {};
		try {
			const { stage, report, lines } = plugin_over(a, { debug: true, keep: [/never/] });
			let edits = 0;
			for (const id of [
				'/app/src/main.ts',
				'/app/src/App.svelte',
				'/app/src/App.svelte?svelte&type=style&lang.css',
				'/app/src/Broken.svelte',
				'/app/node_modules/x/index.js'
			]) {
				if (stage.filter && !stage.filter(id)) continue;
				const code = a.files.get(id)!;
				const edit = new MagicString(code);
				await stage.transform({
					id,
					code,
					edit,
					environment: 'client',
					resolve: (s, importer) => a.resolve(s, importer),
					watch: () => {},
					emit: () => {}
				});
				if (edit.hasChanged()) edits++;
			}
			(report.closeBundle as () => void)();
			return edits + lines.length;
		} finally {
			console.warn = quiet;
		}
	},
	{
		setup: () => ({ a: app(8) }),
		scale: (_ctx, k) => ({ a: app(8 * k) })
	}
);

bench(
	'barrels: the end-of-build report over many barrels, with skipped components',
	({ n }) => {
		const r = fresh_report();
		r.files = n * 4;
		r.last_ms = 1234;
		for (let i = 0; i < n; i++) {
			r.importers++;
			r.imports += 2;
			r.names += 3;
			r.barrels.set(`/app/lib/b${i}/index.ts`, {
				names: (i * 7) % 13,
				importers: new Set([`/app/src/a${i}.ts`, `/app/src/b${i}.ts`])
			});
			if (i % 5 === 0) r.skipped.add(`/app/src/S${i}.svelte`);
		}
		const none = fresh_report();
		none.skipped.add('/app/src/X.svelte');
		const said = Object.values(BARRELS_WARNINGS).map((m) => m.details().length);
		return (
			format_report(r, '/app', 8).length +
			format_report(r, '/app', Infinity).length +
			format_report(none, '/app', 8).length +
			said.length
		);
	},
	{
		setup: () => ({ n: 40 }),
		scale: (_ctx, k) => ({ n: 40 * k })
	}
);
