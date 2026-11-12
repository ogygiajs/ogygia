/**
 * `barrels()`: barrel imports become leaf imports at transform time, listed beside `ogygia()`
 * (`plugins: [ogygia(), barrels(), sveltekit()]`).
 *
 *   import { Button, Card } from '$lib/components';        // an index.ts that re-exports 40 files
 *   → import Button from '/…/components/Button.svelte';
 *     import Card from '/…/components/Card.svelte';
 *
 * Why a plugin and not tree-shaking: dev never tree-shakes (every module behind the barrel is
 * transformed and served); build only drops what `sideEffects: false` allows, and a package that
 * registers components or creates stores is not that; the chunk graph follows the import graph
 * before shaking.
 *
 * It runs at ogygia's `source` stage (before the region transform), on core's seams: the app's
 * export index (`b.exports`, one parse per module, shared with the CSS walk), the imports that carry
 * a region's identity (`b.pinnedImports`, never rewritten), the module's own resolver and watch list.
 * The Svelte parser reads `.svelte` script blocks.
 */
import { searchForWorkspaceRoot, type Plugin } from 'vite';
import { say } from '@ogygia/machine';
import {
	definePlugin,
	type BuildContext,
	type OgygiaPlugin,
	type TransformContext,
	type TransformEvent
} from '@ogygia/compiler/vite';
import { is_script_request, type ExportMap, type Policy } from '@ogygia/compiler';
import { matches_any, normalize_options, type BarrelsOptions } from './options.ts';
import { rewrite_imports, type Lookup, type RewriteMove } from './rewrite.ts';
import { rewrite_svelte } from './svelte.ts';
import { warn, line } from './messages.ts';
import { format_report, fresh_report, short } from './report.ts';

export type { BarrelsOptions, Matcher } from './options.ts';

const IMPORTER_RE = /\.(?:[cm]?[jt]sx?|svelte|svelte\.[jt]s)$/;
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const QUERY_RE = /[?#].*$/;
const BACKSLASH_G = /\\/g;

/** The barrels plugin: its ogygia definition, and the Vite hooks for the logger and the report. */
export function barrels(options: BarrelsOptions | true = {}): [OgygiaPlugin, Plugin] {
	const o = normalize_options(options);
	let root = process.cwd().replace(BACKSLASH_G, '/');
	let log: (msg: string) => void = (msg) => console.log(msg);
	let command: 'build' | 'serve' = 'serve';
	let report = fresh_report();
	const warned = say();

	const policy: Policy = {
		candidate(id, spec) {
			if (o.packages.length && matches_any(o.packages, id, spec)) return true;
			if (o.force.length && matches_any(o.force, id, spec)) return true;
			// default: any project module that is not a dependency; purity decides the rest
			return !NODE_MODULES_RE.test(id) && id.startsWith(`${root}/`);
		},
		forced: (id, spec) => o.force.length > 0 && matches_any(o.force, id, spec),
		kept: (id, spec) => o.keep.length > 0 && matches_any(o.keep, id, spec),
		follow_packages: o.follow_packages
	};

	const is_importer = (id: string): boolean => {
		if (id.includes('\0')) return false;
		// decided on the FULL id: `Foo.svelte?svelte&type=style&lang.css` is the component's CSS
		if (!is_script_request(id)) return false;
		const clean = id.replace(QUERY_RE, '');
		if (!IMPORTER_RE.test(clean)) return false;
		if (o.importer_include.length) return matches_any(o.importer_include, clean, clean);
		if (NODE_MODULES_RE.test(clean)) return false;
		if (o.importer_exclude.length && matches_any(o.importer_exclude, clean, clean)) return false;
		return true;
	};

	const on_skip = (importer: string) => (why: { code: string; line?: number; column?: number }) => {
		// never in silence: a skipped component keeps every barrel it imports. Once per file (a dev
		// server re-transforms on every edit).
		report.skipped.add(importer);
		warned.once(importer, () =>
			warn('barrels_component_skipped', {
				file: short(importer, root),
				reason: why.code,
				at: why.line ? `${why.line}:${why.column ?? 1}` : ''
			})
		);
	};

	const record = (importer: string, moves: RewriteMove[]) => {
		report.importers++;
		report.imports += moves.length;
		for (const m of moves) {
			report.names += m.names.length;
			const entry = report.barrels.get(m.barrel) ?? { names: 0, importers: new Set<string>() };
			entry.names += m.names.length;
			entry.importers.add(importer);
			report.barrels.set(m.barrel, entry);
		}
		if (o.debug)
			for (const m of moves)
				log(
					line('barrels_rewrite', {
						file: short(importer, root),
						names: m.names.join(', '),
						barrel: short(m.barrel, root),
						leaves: m.leaves.map((l) => short(l, root)).join(', ')
					})
				);
	};

	const transform = (b: BuildContext) => async (t: TransformContext) => {
		const t0 = performance.now();
		if (report.files === 0) report.first_ms = t0;
		report.files++;
		const importer = t.id.replace(QUERY_RE, '');
		const seen: ExportMap[] = [];
		const lookup: Lookup = async (spec) => {
			// the importer's own specifier, resolved as the bundler resolves it now
			const resolved = await t.resolve(spec, importer);
			if (!resolved) return null;
			const map = await b.exports.map(resolved, spec, policy, t);
			if (map) seen.push(map);
			return map;
		};
		// each import left on its barrel is told, so a finding can say why the barrel stayed
		const left = (barrel: string | null, names: string[], reason: TransformEvent['reason']) =>
			t.emit({ domain: 'compile', name: 'compile.barrel.left', barrel, names, reason });
		const rewrite = { skip: b.pinnedImports(t.code), left };
		const skipped = on_skip(importer);
		const moves = importer.endsWith('.svelte')
			? await rewrite_svelte(t.code, importer, lookup, t.edit, rewrite, (why) => {
					skipped(why);
					left(null, [], 'unparsable');
				})
			: await rewrite_imports(t.code, importer, lookup, t.edit, 0, rewrite);
		// The importer no longer imports the barrels it was rewritten away from: watch them (and what
		// their maps depend on) so an edit still re-transforms it in dev. A virtual module is no file.
		for (const m of seen) for (const d of m.deps) if (!d.includes('\0')) t.watch(d);
		report.last_ms = performance.now();
		if (moves.length) record(importer, moves);
	};

	return [
		definePlugin({
			name: '@ogygia/barrels',
			build(b) {
				b.transform({ stage: 'source', filter: is_importer, transform: transform(b) });
			}
		}),
		{
			name: '@ogygia/barrels:report',
			configResolved(config) {
				// The PROJECT is the workspace, not the app: in a monorepo the barrels that matter live in
				// sibling packages, outside the Vite root.
				root = searchForWorkspaceRoot(config.root).replace(BACKSLASH_G, '/');
				command = config.command;
				log = (msg) => config.logger.info(msg);
			},
			// Once per build leg (Kit builds client then server); dev prints nothing here.
			closeBundle() {
				if (o.report && command === 'build')
					log(format_report(report, root, o.report === 'all' ? Infinity : 8));
				report = fresh_report();
			}
		}
	];
}
