import { regionBindingVirtualId, lazyEntryVirtualId } from '../ids.ts';

function render_html_source(moduleUrl: string): string {
	return `(props, wakes) => __ogRegionHtml(__ogRegionComp, ${JSON.stringify(moduleUrl)}, props, wakes)`;
}

/**
 * The component-import line for a generated module — a NAMED export (`import { Header as X } from
 * '@barrel'`, a marked named import) or a plain default (`import X from './X.svelte'`, a
 * `.svelte` file or a package default). `exportName` is undefined/`'default'` for the default case.
 */
export function component_import_line(local: string, spec: string, exportName?: string): string {
	return exportName && exportName !== 'default'
		? `import { ${exportName} as ${local} } from ${JSON.stringify(spec)};`
		: `import ${local} from ${JSON.stringify(spec)};`;
}

function region_entry_source(componentPath: string, iid: string, exportName?: string) {
	return `${component_import_line(`__OgygiaComp_${iid}`, componentPath, exportName)}
export default __OgygiaComp_${iid};
`;
}

/**
 * The island ENTRY module — a JS re-export of the real component, loaded on both client hydrate and
 * server render. The transportables import registers every `[ogygia.wire]` codec before props decode,
 * so an island receiving a transportable prop never needs to import the class itself. Shared by the
 * `.svelte` host and the `.ts` registry (a `wake:` mark) so a mountable binding is built the same way
 * from either.
 */
export function island_entry_source(
	componentPath: string,
	iid: string,
	exportName?: string
): string {
	return `import 'ogygia:region/transportables-eager';
${component_import_line(`__OgygiaComp_${iid}`, componentPath, exportName)}
export default __OgygiaComp_${iid};
${FOREIGN_HYDRATE_MARK}import { og_entry_hydrate as __og_hy, og_entry_unmount as __og_unmount } from 'ogygia/internal';
export function __og_hydrate(target, props, options) {
\treturn __og_hy(__OgygiaComp_${iid}, target, props, options);
}
export { __og_unmount };
`;
}

/** Where an island entry's foreign-hydrate exports begin (compiler/driver.ts cuts from here). */
export const FOREIGN_HYDRATE_MARK = '// og:foreign-hydrate\n';

/**
 * The island WRAPPER (`.svelte`) — a MOUNTABLE component that renders `<ogygia-region>` on its wake
 * schedule. Placing it (`<C/>`, `<svelte:component this={C}/>`) emits the shell; the island's JS is
 * fetched only when the shell wakes (e.g. `wake: 'visible'` → on scroll-into-view). Shared by the
 * `.svelte` host and the `.ts` registry. `entry_url` is the resolved client/dev module URL the caller
 * computes (ctx-dependent). Plain JavaScript, whatever the host's lang: every host that marks the
 * component this way shares this one module (test/region-identity-canonical.test.ts).
 */
export function island_wrapper_source(
	iid: string,
	componentPath: string,
	entryPath: string,
	strategy: string,
	options: Record<string, unknown> | undefined,
	exportName: string | undefined,
	entry_url: string
): string {
	const strategy_attrs = strategy_to_attr(strategy, options);
	const persist_attr = options?.keep ? ` __keep={${JSON.stringify(options.keep)}}` : '';
	return `<script>
\timport { Region as OgygiaRegion__Wrapper } from 'ogygia/internal';
\timport __OgygiaEntry from ${JSON.stringify(entryPath)};
\t${component_import_line('__OgygiaCss', componentPath, exportName)}
\tlet { children, ...__props } = $props();
</script>
<OgygiaRegion__Wrapper __mode="island" ${strategy_attrs}${persist_attr} __entry={${JSON.stringify(entry_url)}} __component={__OgygiaEntry} __css={__OgygiaCss} {__props} {children} />
`;
}

/**
 * The island wrapper's CLIENT leg (a csr=true-capable host imports it; Kit hydrates the island
 * inline as a normal component). The SSR wrapper imports the component statically — it must
 * render. The client wrapper must NOT: Kit links a route's `node.stylesheets` and preloads from the
 * page's STATIC client graph, so a registry of N marked blocks imported by a csr=true route linked
 * every block's CSS + chunk on every page (a newsroom page: 172 stylesheets for 4 islands). The
 * component therefore comes through `lazy_entry_source` — a top-level-await module that imports
 * the real entry only for the islands this document RENDERED (the SSR stamped a
 * `<meta name="ogygia-kit-island">` per rendered island), so Kit still hydrates them in place with
 * the component in hand, and a block nobody rendered costs nothing. Mounted fresh on a Kit
 * client-side navigation (no SSR, no stamp), the wrapper loads the entry on demand and renders once
 * it lands — a client render, so no hydration to mismatch.
 */
export function island_wrapper_client_source(
	iid: string,
	lazyPath: string,
	strategy: string,
	options: Record<string, unknown> | undefined,
	entry_url: string
): string {
	const strategy_attrs = strategy_to_attr(strategy, options);
	const persist_attr = options?.keep ? ` __keep={${JSON.stringify(options.keep)}}` : '';
	return `<script>
\timport { Region as OgygiaRegion__Wrapper } from 'ogygia/internal';
\timport __OgygiaEntry, { load as __OgygiaLoad } from ${JSON.stringify(lazyPath)};
\tlet { children, ...__props } = $props();
</script>
<OgygiaRegion__Wrapper __mode="island" ${strategy_attrs}${persist_attr} __entry={${JSON.stringify(entry_url)}} __component={__OgygiaEntry} __load={__OgygiaLoad} {__props} {children} />
`;
}

/**
 * The client wrapper's component source (`lazyEntryVirtualId`). Decides ONCE, at module
 * evaluation — before Kit hydrates, because Kit awaits the page node's import and a top-level
 * await holds it. The two facts it reads are the document's own: `documentIsCsrTrue()` (the ONE
 * csr fact Region reads on both legs) and the `<meta name="ogygia-kit-island">` stamp Region
 * emits per rendered inline island (context.ts `claim_kit_island`).
 *   - not a Kit-hydrated document (the runtime woke this island's parent; no stamp exists there):
 *     import the entry now — a nested island must be in hand when its parent hydrates;
 *   - a Kit document that rendered this island: import the entry now, Kit hydrates it in place;
 *   - a Kit document that did NOT render it (an unrendered registry block): `undefined`, nothing
 *     fetched, nothing linked — `load()` is the on-demand path a client-side navigation takes.
 * `entry_url` is the same string Region bakes into the stamp (`__entry`), on both legs.
 */
export function lazy_entry_source(entryPath: string, entry_url: string): string {
	const entry = JSON.stringify(entryPath);
	const stamp = JSON.stringify(
		`meta[name="ogygia-kit-island"][content=${JSON.stringify(entry_url)}]`
	);
	return `import { documentIsCsrTrue } from 'ogygia/internal';
const rendered = typeof document !== 'undefined' && !!document.querySelector(${stamp});
export default documentIsCsrTrue() && !rendered ? undefined : (await import(${entry})).default;
export const load = () => import(${entry}).then((m) => m.default);
`;
}

/**
 * Build the held-region descriptor shared by the `.svelte` and `.ts` paths. It ALWAYS carries a
 * client chunk + `__module` (the region MIGHT be woken); when used statically the chunk is simply
 * never fetched (HTML only at runtime). Two marker flavors feed it:
 *   - `wake: 'x'`      → bakes `__hydrate: 'x'` — `region(C, props)` wakes on that schedule.
 *   - `region: 'raw'`  → bakes NO schedule — `region(C, props, { wake })` sets it at the call.
 * `region()` reads `opts.wake ?? binding.__hydrate`, so a baked schedule is the default and the call
 * can override. `kind` is always `'hydrate'` so the chunk is emitted; `server:true` — the endpoint
 * renders the HTML either way.
 */
export function make_region_binding(opts: {
	iid: string;
	componentPath: string;
	entryPath: string;
	hostPath: string;
	moduleUrl: string;
	/** baked wake schedule from a `wake:` mark; absent for `region: 'raw'` (schedule set at the call) */
	hydrate?: string;
	/** rootMargin baked when `hydrate` is `'visible'` */
	hydrateMargin?: string;
	/** named export to pull (a marked named import); undefined → default import */
	exportName?: string;
	identity: string;
}): {
	id: string;
	virtualPath: string;
	source: string;
	bindingPath: string;
	bindingSsrSource: string;
	bindingClientSource: string;
	hostPath: string;
	componentPath: string;
	server: boolean;
	kind: string;
	held: boolean;
	lakes: never[];
	identity: string;
} {
	let meta = `__ogRegion: ${JSON.stringify(opts.iid)}, __module: ${JSON.stringify(opts.moduleUrl)}`;
	if (opts.hydrate) meta = `${meta}, __hydrate: ${JSON.stringify(opts.hydrate)}`;
	if (opts.hydrate && opts.hydrateMargin != null)
		meta = `${meta}, __hydrateMargin: ${JSON.stringify(opts.hydrateMargin)}`;
	const ssr_source = `${component_import_line('__ogRegionComp', opts.componentPath, opts.exportName)}
import { make_region_endpoint as __ogRegionSign, render_region_html as __ogRegionHtml } from 'ogygia/internal/server';
export default { ${meta}, __component: __ogRegionComp, __sign: __ogRegionSign, __renderHtml: ${render_html_source(opts.moduleUrl)} };
`;
	return {
		id: opts.iid,
		virtualPath: opts.entryPath,
		source: region_entry_source(opts.componentPath, opts.iid, opts.exportName),
		bindingPath: regionBindingVirtualId(opts.iid),
		bindingSsrSource: ssr_source,
		bindingClientSource: `export default { ${meta} };\n`,
		hostPath: opts.hostPath,
		componentPath: opts.componentPath,
		server: true,
		kind: 'hydrate',
		held: true,
		lakes: [],
		identity: opts.identity
	};
}

function wrapper_attach_binding(opts: {
	iid: string;
	wrapperPath: string;
	componentPath: string;
	moduleUrl: string;
	hydrate: string;
	hydrateMargin?: string;
	exportName?: string;
}) {
	let meta = `__ogRegion: ${JSON.stringify(opts.iid)}, __module: ${JSON.stringify(opts.moduleUrl)}`;
	if (opts.hydrate) meta = `${meta}, __hydrate: ${JSON.stringify(opts.hydrate)}`;
	if (opts.hydrate && opts.hydrateMargin != null)
		meta = `${meta}, __hydrateMargin: ${JSON.stringify(opts.hydrateMargin)}`;
	return {
		ssr: `import __OgygiaWrap from ${JSON.stringify(opts.wrapperPath)};
${component_import_line('__ogRegionComp', opts.componentPath, opts.exportName)}
import { make_region_endpoint as __ogRegionSign, render_region_html as __ogRegionHtml } from 'ogygia/internal/server';
Object.assign(__OgygiaWrap, { ${meta}, __component: __ogRegionComp, __sign: __ogRegionSign, __renderHtml: ${render_html_source(opts.moduleUrl)} });
export default __OgygiaWrap;
`,
		client: `import __OgygiaWrap from ${JSON.stringify(opts.wrapperPath)};
Object.assign(__OgygiaWrap, { ${meta} });
export default __OgygiaWrap;
`
	};
}

/**
 * The complete island record for a `wake:` mark — the ONE emitter shared by the `.svelte` host (a
 * placed `import X with { wake }`) and the `.ts` registry (a `wake:` mark handed to a renderer). The
 * binding it produces is BOTH mountable (placing it, incl. via `<svelte:component>`, renders the
 * `<ogygia-region>` shell that fetches the island JS only on its schedule) AND holdable (the descriptor
 * fields ride on the wrapper, so `region(C)` still works). Threading both paths through here is what
 * keeps `.svelte` and `.ts` `wake:` byte-identical — a `.ts` `wake: 'visible'` is exactly a `.svelte`
 * `wake: 'visible'`. Callers own the host-specific import rewrite; this owns the record.
 * `moduleUrl` is the resolved client/dev module URL.
 */
export function make_wake_island(opts: {
	iid: string;
	componentPath: string;
	entryPath: string;
	wrapperPath: string;
	moduleUrl: string;
	strategy: string;
	options?: Record<string, unknown>;
	exportName?: string;
	hostPath: string;
	identity: string;
	/**
	 * A `.ts` registry / remote binding, which may be handed to `region()` and CROSS the wire (a live
	 * or remote region): it needs a server-manifest entry (`server`) so its endpoint can render it, and
	 * the `held` mark that pulls in the live/morph runtime. A `.svelte` placed island never crosses, so
	 * it stays `server:false`. Either way the binding is the SAME mountable wrapper — only the manifest
	 * flags differ, which is also why the two carry distinct identities (an endpoint vs none).
	 */
	held?: boolean;
}): {
	kind: string;
	lakes: never[];
	identity: string;
	strategy: string;
	keep: unknown;
	held?: boolean;
	id: string;
	virtualPath: string;
	wrapperPath: string;
	wrapperSource: string;
	wrapperClientSource: string;
	lazyPath: string;
	lazySource: string;
	bindingPath: string;
	bindingSsrSource: string;
	bindingClientSource: string;
	source: string;
	hostPath: string;
	componentPath: string;
	server: boolean;
} {
	const margin =
		opts.strategy === 'visible' ? (opts.options?.margin as string | undefined) : undefined;
	const attach = wrapper_attach_binding({
		iid: opts.iid,
		wrapperPath: opts.wrapperPath,
		componentPath: opts.componentPath,
		moduleUrl: opts.moduleUrl,
		hydrate: opts.strategy,
		hydrateMargin: margin,
		exportName: opts.exportName
	});
	const lazyPath = lazyEntryVirtualId(opts.iid);
	return {
		id: opts.iid,
		virtualPath: opts.entryPath,
		wrapperPath: opts.wrapperPath,
		wrapperSource: island_wrapper_source(
			opts.iid,
			opts.componentPath,
			opts.entryPath,
			opts.strategy,
			opts.options,
			opts.exportName,
			opts.moduleUrl
		),
		wrapperClientSource: island_wrapper_client_source(
			opts.iid,
			lazyPath,
			opts.strategy,
			opts.options,
			opts.moduleUrl
		),
		lazyPath,
		lazySource: lazy_entry_source(opts.entryPath, opts.moduleUrl),
		bindingPath: regionBindingVirtualId(opts.iid),
		bindingSsrSource: attach.ssr,
		bindingClientSource: attach.client,
		source: island_entry_source(opts.componentPath, opts.iid, opts.exportName),
		hostPath: opts.hostPath,
		componentPath: opts.componentPath,
		server: !!opts.held,
		...(opts.held ? { held: true } : {}),
		kind: 'hydrate',
		lakes: [],
		identity: opts.identity,
		strategy: opts.strategy,
		keep: opts.options?.keep
	};
}

/**
 * The SERVER-island wrapper (`.svelte`) — `render: 'deferred'`: a hole whose HTML is fetched on the
 * `wake` schedule. `__defer` carries the fetch schedule; `__cacheTtl` (when signed) sets the hole's
 * response cache; a deferred island that ALSO hydrates carries `__hydrate` + `__module` (its client
 * entry URL). `module_url` is the resolved client/dev entry URL (used only when it hydrates).
 * @param component false for the client leg, which imports no component: a hole ships no JS.
 */
export function server_wrapper_source(
	iid: string,
	componentPath: string,
	entryPath: string,
	options: Record<string, unknown> | undefined,
	exportName: string | undefined,
	module_url: string,
	component = true
): string {
	const deferred_hydrate = !!options?.hydrate;
	const fetch_when = options?.when || 'load';
	let server_attrs = `__defer={${JSON.stringify(fetch_when)}}`;
	if (options?.stitch)
		server_attrs = `${server_attrs} __stitch={${JSON.stringify(options.stitch)}}`;
	if (options?.prefetch)
		server_attrs = `${server_attrs} __prefetch={${JSON.stringify(options.prefetch)}}`;
	if (options?.margin != null)
		server_attrs = `${server_attrs} __margin={${JSON.stringify(options.margin)}}`;
	if (options?.cacheTtlSec != null)
		server_attrs = `${server_attrs} __cacheTtl={${JSON.stringify(options.cacheTtlSec)}}`;
	if (deferred_hydrate) {
		server_attrs = `${server_attrs} __hydrate={${JSON.stringify(options.hydrate)}}`;
		server_attrs = `${server_attrs} __module={${JSON.stringify(module_url)}}`;
		if (options.hydrateMargin != null) {
			server_attrs = `${server_attrs} __hydrateMargin={${JSON.stringify(options.hydrateMargin)}}`;
		}
	}
	const component_imports = component
		? `	import __OgygiaEntry from ${JSON.stringify(entryPath)};
	${component_import_line('__OgygiaCss', componentPath, exportName)}
`
		: '';
	const component_attrs = component ? `__component={__OgygiaEntry} __css={__OgygiaCss} ` : '';
	return `<script>
\timport { Region as OgygiaRegion__Wrapper } from 'ogygia/internal';
${component_imports}\tlet { ogygiaFallback, ...__props } = $props();
</script>
<OgygiaRegion__Wrapper __mode="server" __entry={${JSON.stringify(iid)}} ${component_attrs}{__props} ${server_attrs} {ogygiaFallback} />
`;
}

/**
 * The LAKE wrapper (`.svelte`) — `render: page, wake: none`: a frozen region inside a hydrated island.
 * Every lake hands Region its props (`__props`): its identity (`data-og-lake`) is a fingerprint of
 * them. A `swr` lake also carries an endpoint (`__when`) to remount on its schedule; `cache`/`empty`
 * are wrapper-only. Static `<OgygiaLakeInner>` (not dynamic) preserves the LAKE-ENVELOPE; the client
 * build swaps that import for the render-nothing stub.
 */
export function lake_wrapper_source(
	iid: string,
	componentPath: string,
	options: Record<string, unknown> | undefined,
	exportName: string | undefined
): string {
	const remount = options?.remount || 'cache';
	const needs_endpoint = remount === 'swr';
	const when = options?.when || (needs_endpoint ? 'load' : undefined);
	let attrs = `__entry={${JSON.stringify(iid)}} __remount={${JSON.stringify(remount)}} __props={__props}`;
	if (options?.maxAgeMs != null) attrs = `${attrs} __maxAge={${JSON.stringify(options.maxAgeMs)}}`;
	if (options?.onExpire) attrs = `${attrs} __onExpire={${JSON.stringify(options.onExpire)}}`;
	if (needs_endpoint) {
		attrs = `${attrs} __when={${JSON.stringify(when || 'load')}}`;
		if (options?.margin != null) attrs = `${attrs} __margin={${JSON.stringify(options.margin)}}`;
	}
	return `<script>
\timport { Region as OgygiaRegion__Wrapper } from 'ogygia/internal';
\t${component_import_line('OgygiaLakeInner', componentPath, exportName)}
\tlet __props = $props();
</script>
<OgygiaRegion__Wrapper __mode="lake" ${attrs}><OgygiaLakeInner {...__props} /></OgygiaRegion__Wrapper>
`;
}

/** Map a hydrate strategy (+ options) to the Island wrapper attribute markup. */
export function strategy_to_attr(strategy: string, options?: Record<string, unknown>): string {
	if (!strategy || strategy === 'load') return 'load';
	if (strategy === 'idle') return 'idle';
	if (strategy === 'interaction') return 'interaction';
	if (strategy === 'visible') {
		return options && options.margin != null
			? `visible=${JSON.stringify(options.margin)}`
			: 'visible';
	}
	return `media=${JSON.stringify(strategy)}`;
}

/** Rewrite `$app/{state,stores,navigation}` string literals to absolute shim paths. */
export const APP_SHIM_IMPORT: RegExp = /(['"])\$app\/(state|stores|navigation)\1/g;

const REGEXP_META = /[.*+?^${}()|[\]\\]/g;
const IMPORT_AS_CLAUSE = /^(.+?)(?:\s+as\s+(\w+))?$/;

/**
 * Rewrite a lake binding's import to the render-nothing placeholder (client island modules only).
 * Default imports are repointed; named imports drop that specifier (and keep siblings) then add a
 * default import of the placeholder under the same local name.
 *
 * @internal Used by the plugin client emit and unit tests.
 */
export function rewrite_lake_import_to_placeholder(
	src: string,
	local: string,
	placeholder: string
): string {
	const esc = local.replace(REGEXP_META, '\\$&');
	const ph = JSON.stringify(placeholder);
	src = src.replace(
		new RegExp(`import\\s+${esc}\\s+from\\s+(['"])[^'"]+\\1`, 'g'),
		`import ${local} from ${ph}`
	);
	src = src.replace(
		new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*(['"])([^'"]+)\\2`, 'g'),
		(full, specs, _q, from) => {
			const parts = String(specs)
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			const kept = [];
			let hit = false;
			for (const p of parts) {
				const m = p.match(IMPORT_AS_CLAUSE);
				if (!m) {
					kept.push(p);
					continue;
				}
				const imported = m[1].trim();
				const alias = (m[2] || imported).trim();
				if (alias === local) {
					hit = true;
					continue;
				}
				kept.push(p);
			}
			if (!hit) return full;
			const named = kept.length
				? `import { ${kept.join(', ')} } from ${JSON.stringify(from)};`
				: '';
			return `import ${local} from ${ph};${named ? `\n\t${named}` : ''}`;
		}
	);
	return src;
}
