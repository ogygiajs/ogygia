/**
 * The analyses that predict what a page does at run time, as data. Each one leans one way when it
 * is unsure, and this table says which:
 *
 * - `over`: the answer must hold every run-time behavior (a miss breaks a page; an extra costs bytes);
 * - `under`: the answer must hold only safe cases (a wrong yes breaks a page);
 * - `exact`: both directions break a page.
 *
 * `fallback` is what it answers when it cannot decide: always the safe end. `oracle` is the issue
 * that will bring a check judging the answer against what really ran, until one exists; an oracle
 * names the analysis with a `// oracle: <name>` line at its top. test/analyses.test.ts holds this
 * table true (files, functions, oracles, gaps).
 */

/** The open issue that tracks every analysis with no oracle yet. */
export const ORACLE_GAPS = 1489;

export interface Analysis {
	/** snake_case; an oracle names it with `// oracle: <name>`. */
	readonly name: string;
	/** What it predicts, in plain words. */
	readonly predicts: string;
	readonly direction: 'over' | 'under' | 'exact';
	/** The safe answer it gives when it cannot decide. */
	readonly fallback: string;
	/** Under `packages/compiler/src/compiler/`, and the function or class that answers. */
	readonly where: { readonly file: string; readonly symbol: string };
	/** The issue for an oracle while there is none; `null` once a file carries the marker. */
	readonly gap: number | null;
}

export const ANALYSES: readonly Analysis[] = [
	{
		name: 'seed_keys',
		predicts: "the page.data keys an island's client code reads",
		direction: 'over',
		fallback: "'all' (the whole page.data ships)",
		where: { file: 'link/page-keys.ts', symbol: 'page_data_keys_answer' },
		gap: null
	},
	{
		name: 'hole_reads_page',
		predicts: "whether a server hole's tree reads page.data",
		direction: 'over',
		fallback: 'true (the hole looks page.data up)',
		where: { file: 'link/relocations.ts', symbol: 'PAGE_DATA_READS' },
		gap: ORACLE_GAPS
	},
	{
		name: 'island_reads_page',
		predicts: "whether an island's code reaches Kit's page world",
		direction: 'over',
		fallback: 'a reader (the page shim is linked)',
		where: { file: 'driver.ts', symbol: 'mark_island_closure' },
		gap: ORACLE_GAPS
	},
	{
		name: 'wire_crossing',
		predicts: "whether the server encodes a live value into an island's props",
		direction: 'over',
		fallback: 'none in the build; the codec loads on use (#1306)',
		where: { file: 'region/transform.ts', symbol: 'hasWireCrossing' },
		gap: ORACLE_GAPS
	},
	{
		name: 'transportable',
		predicts: 'which modules define wire classes (loaders, eager list, the wire mark)',
		direction: 'over',
		fallback: 'true (the module counts)',
		where: { file: 'transportables.ts', symbol: 'moduleHasTransportable' },
		gap: null
	},
	{
		name: 'context_mark',
		predicts: 'whether the app provides ogygia context (the bridge feature)',
		direction: 'over',
		fallback: 'all: a form the walk cannot narrow reaches every export',
		where: { file: 'link/own-reach.ts', symbol: 'reaches_context' },
		gap: ORACLE_GAPS
	},
	{
		name: 'crosses_kit_wire',
		predicts: "whether Kit's transport must carry ogygia codecs",
		direction: 'over',
		fallback: 'all: a form the walk cannot narrow reaches every export',
		where: { file: 'link/own-reach.ts', symbol: 'reaches_wire' },
		gap: ORACLE_GAPS
	},
	{
		name: 'route_csr',
		predicts: "Kit's csr for a route option file",
		direction: 'exact',
		fallback: "undefined (Kit's default)",
		where: { file: 'kit.ts', symbol: 'read_csr' },
		gap: null
	},
	{
		name: 'route_config',
		predicts: "each page's merged route config",
		direction: 'exact',
		fallback: 'no keys',
		where: { file: 'kit.ts', symbol: 'page_route_config' },
		gap: ORACLE_GAPS
	},
	{
		name: 'free_vars',
		predicts: 'the names a portable snippet must import or receive',
		direction: 'over',
		fallback: 'none: an unseen name is a miss',
		where: { file: 'free-vars.ts', symbol: 'collectCaptureInfo' },
		gap: ORACLE_GAPS
	},
	{
		name: 'dollar_captures',
		predicts: 'the names a hoisted og.$ factory closes over',
		direction: 'exact',
		fallback: 'none: a wrong capture throws at the site',
		where: { file: 'macros/dollar.ts', symbol: 'rewrite_dollar' },
		gap: ORACLE_GAPS
	},
	{
		name: 'barrel_pure',
		predicts: 'a barrel import can be dropped',
		direction: 'under',
		fallback: 'impure (the import stays)',
		where: { file: 'exports/parse.ts', symbol: 'analyze_exports' },
		gap: ORACLE_GAPS
	},
	{
		name: 'export_walk',
		predicts: 'the module each exported name comes from (and the walk ends)',
		direction: 'exact',
		fallback: 'no map (the import stays as written)',
		where: { file: 'exports/index.ts', symbol: 'Walk' },
		gap: ORACLE_GAPS
	},
	{
		name: 'css_reach',
		predicts: 'the CSS a lake, hole, router page or content module needs',
		direction: 'over',
		fallback: 'none: an unseen stylesheet is a miss',
		where: { file: 'fouc-css.ts', symbol: 'collectFoucCssReachable' },
		gap: ORACLE_GAPS
	},
	{
		name: 'ownership_stamps',
		predicts: 'the elements Svelte hydration never walks',
		direction: 'under',
		fallback: 'no stamps',
		where: { file: 'ownership-stamps.ts', symbol: 'stamp_opaque' },
		gap: ORACLE_GAPS
	},
	{
		name: 'csr_true_degrade',
		predicts: 'which regions Kit owns on a csr=true page',
		direction: 'exact',
		fallback: 'none',
		where: { file: 'region/transform.ts', symbol: '#kit_owns' },
		gap: ORACLE_GAPS
	},
	{
		name: 'registry_reach',
		predicts: 'whether a csr=false route edge reaches a region registry',
		direction: 'over',
		fallback: 'reaches (the full registry stays in the graph)',
		where: { file: 'driver.ts', symbol: '#reaches_registry' },
		gap: ORACLE_GAPS
	},
	{
		name: 'emit_gate',
		predicts: 'the islands whose host the server bundle loads',
		direction: 'over',
		fallback: 'every island (no handoff emits all)',
		where: { file: 'link/emit-gate.ts', symbol: 'island_host_loaded' },
		gap: ORACLE_GAPS
	},
	{
		name: 'island_remotes',
		predicts: 'the remote seeds and page seed each island needs',
		direction: 'over',
		fallback: 'all (no map fails open)',
		where: { file: 'link/island-deps.ts', symbol: 'collectIslandDepModulepreloads' },
		gap: ORACLE_GAPS
	},
	{
		name: 'runtime_features',
		predicts: 'the runtime features a page needs',
		direction: 'over',
		fallback: 'every feature (incomplete marks ship the full runtime)',
		where: { file: 'link/runtime-entry.ts', symbol: 'resolveFeatures' },
		gap: ORACLE_GAPS
	},
	{
		name: 'region_options',
		predicts: 'the region config an import attribute or option asks for',
		direction: 'exact',
		fallback: 'a build error naming the option',
		where: { file: 'region/transform.ts', symbol: 'transformHost' },
		gap: ORACLE_GAPS
	}
];
