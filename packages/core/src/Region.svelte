<!--
@component
A region: one place on a page whose HTML the server renders and whose code, if any, wakes on its own
schedule. `<Region of={value} />` renders a held region value from `region()`, or a promise of one (a
remote call); `placeholder` shows while it is not ready yet. Placed regions (`wake`, `render`,
`'none'` on an import) render through it too, through the props the compiler writes.
-->
<script lang="ts">
	import {
		untrack,
		getContext,
		getAllContexts,
		setContext,
		createRawSnippet,
		mount,
		unmount,
		type Component,
		type Snippet
	} from 'svelte';
	import {
		KIT_REQUEST_CONTEXT,
		kit_page_version,
		kit_request_event
	} from './server/kit-context.ts';
	import { stringify } from 'devalue';
	import { dev_hmr_url } from './dev-hmr-url.ts';
	import {
		region_deps,
		region_css,
		content_css,
		region_reads_page,
		region_page_keys,
		region_remotes,
		region_interactivity,
		entry_location,
		make_region_endpoint,
		mint_server_region,
		reuse_known_region,
		region_fingerprint,
		hole_css,
		runtime_bootstrap,
		region_css_tag,
		head_owner_attr
	} from '#region-server';
	import { hole_copy_of } from './contract/hash.ts';
	import { kit_asset } from './kit-paths.ts';
	import { building } from '$app/env';
	import { page } from '$app/state';
	import { record_page } from './page-seed-registry.ts';
	import { document_tail, island_graph_script, modulepreload_tag } from './server/document-tail.ts';
	import { hole_identity, lake_identity, PropsWire, props_sidecar } from './server/props-wire.ts';
	import { escape_amp_quot, escape_attr } from './escape.ts';
	import { warn } from './messages/island.ts';
	import {
		isNested,
		setNested,
		nested_wake,
		isInLake,
		isInLiveSnippet,
		setInLiveSnippet,
		setHoleInline,
		documentIsCsrTrue,
		claimRuntimeEmit,
		claim_region_css,
		claim_kit_island,
		head_owner,
		set_head_owner,
		note_early_hole
	} from './context.ts';
	import {
		prepare_region_props,
		slot_pointer,
		slot_marker_open,
		SLOT_MARKER_CLOSE,
		next_slot_id,
		HOLE_SLOT_SEQUENCE
	} from './region-snippet.ts';
	import { isRegion, type DeferredRegion, type DualRegion, type RegionValue } from './region.ts';
	import { written_order } from './frame.ts';
	import LateIsland from './LateIsland.svelte';
	import PromiseRegion from './PromiseRegion.svelte';
	import LakeBoundary from './LakeBoundary.svelte';
	import SlotBoundary from './SlotBoundary.svelte';
	import { record_server_event } from './events/server-registry.ts';

	const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

	/** A region's props: `of` and its waiting UI for a held region; the `__*` props, from the compiler, for a placed one. */
	interface Props {
		/** The region to render: a value from `region()`, or a promise of one (a remote call). */
		of?: RegionValue | Promise<RegionValue>;
		/** What shows while a promise `of` is in flight, and while a live region's HTML is still on its way. */
		placeholder?: Snippet;
		/** The rendered component's children; where there is no `placeholder`, the waiting UI. */
		children?: Snippet;
		__mode?: 'island' | 'server' | 'lake';
		__baked?: boolean;
		visible?: string | boolean;
		idle?: boolean;
		media?: string;
		load?: boolean;
		interaction?: boolean;
		__keep?: string;
		__entry?: string;
		__component?: Component;
		__css?: unknown;
		__load?: () => Promise<Component>;
		__props?: Record<string, unknown>;
		__defer?: string;
		__margin?: string;
		__hydrate?: string;
		__hydrateMargin?: string;
		__module?: string;
		__cacheTtl?: number;
		__stitch?: string;
		__prefetch?: string;
		ogygiaFallback?: Snippet;
		__remount?: string;
		__when?: string;
		__maxAge?: number;
		__onExpire?: 'empty' | 'fetch';
	}

	let {
		of,
		placeholder,
		children,
		__baked = false,
		__mode,
		visible,
		idle,
		media,
		load,
		interaction,
		__keep,
		__entry = '',
		__component,
		__load,
		__props,
		__defer = 'load',
		__margin,
		__hydrate,
		__hydrateMargin,
		__module = '',
		__cacheTtl,
		__stitch = '',
		__prefetch = '',
		ogygiaFallback,
		__remount = 'cache',
		__when = 'load',
		__maxAge,
		__onExpire
	}: Props = $props();

	// @why a closing script tag written out inside a script ends it, even in a comment (test: internal/checks/shipped-svelte.test.ts › every shipped component passes)
	const LT = String.fromCharCode(60);
	const GT = String.fromCharCode(62);

	function adopt_region(
		attrs: () => string,
		inner?: (renderer: never) => void,
		setup?: (el: Element) => void | (() => void)
	): Snippet {
		return typeof window === 'undefined'
			? (((renderer: { push(html: string): void }) => {
					renderer.push(`${LT}ogygia-region${attrs()}${GT}`);
					inner?.(renderer as never);
					renderer.push(`${LT}/ogygia-region${GT}`);
				}) as unknown as Snippet)
			: createRawSnippet(() => ({
					render: () => `${LT}ogygia-region${attrs()}${GT}${LT}/ogygia-region${GT}`,
					setup
				}));
	}
	const KIT_PAGE_PASS = Symbol.for('ogygia.kit-page-pass');

	const of_is_promise = untrack(
		() => !!of && typeof (of as { then?: unknown }).then === 'function' && !isRegion(of)
	);
	const no_waiting_ui = untrack(() => !placeholder && !children);
	if (of_is_promise && no_waiting_ui && import.meta.env && import.meta.env.DEV) {
		warn('region_promise_no_placeholder');
	}
	const resolved = $derived(of_is_promise ? undefined : (of as RegionValue | undefined));
	const holds_live =
		of_is_promise || untrack(() => (of as { kind?: string } | undefined)?.kind === 'deferred');

	const of_init = of_is_promise ? undefined : untrack(() => of as RegionValue | undefined);
	const held_dual_island = !!(of_init && of_init.kind === 'dual' && of_init.hydrate);
	const mode = untrack(() => __mode);
	const is_island = mode === 'island' || held_dual_island;
	const is_server = mode === 'server';
	const is_lake = mode === 'lake';

	const in_live_snippet = isInLiveSnippet();
	const nested = isNested() && !(is_server && in_live_snippet);
	if (is_island && nested && in_live_snippet) setInLiveSnippet(false);
	const region_contexts = typeof window !== 'undefined' && is_server ? getAllContexts() : undefined;

	let render_root: 'kit' | 'ogygia' | null = null;
	if (typeof window === 'undefined') {
		const req = getContext(KIT_REQUEST_CONTEXT) as { page?: unknown; event?: unknown } | undefined;
		render_root =
			getContext(KIT_PAGE_PASS) === true || (req && req.event == null)
				? 'kit'
				: req
					? 'ogygia'
					: null;
		if (render_root === 'kit' && getContext(KIT_PAGE_PASS) !== true)
			setContext(KIT_PAGE_PASS, true);
		if (req && req.event == null) {
			const event = kit_request_event();
			if (event) setContext(KIT_REQUEST_CONTEXT, { ...req, event });
		}
	}
	const tail = typeof window === 'undefined' && render_root === 'kit' ? document_tail() : null;
	function page_error_render() {
		try {
			return page.error != null;
			// oxlint-disable-next-line ogygia/no-silent-failures -- isolated render without a live page (a hole endpoint, a remote's region)
		} catch {
			return false;
		}
	}
	const is_csr = documentIsCsrTrue(page_error_render()) && !isInLake() && render_root !== 'ogygia';
	const island_inline = nested || is_csr;
	if (is_island && !nested) setNested(true, () => hydrate_attr);
	else if (is_server && !nested) setNested();
	if (is_server && nested) setHoleInline();

	const as_dual: DualRegion | undefined = $derived(
		held_dual_island && resolved?.kind === 'dual' ? resolved : undefined
	);
	const island_entry = $derived(as_dual ? as_dual.module : __mode === 'island' ? __entry : '');
	const island_component = $derived(as_dual ? as_dual.component : __component);
	const late_load = $derived(
		typeof window !== 'undefined' && island_inline && !__component ? __load : undefined
	);
	const island_props = $derived(as_dual ? as_dual.props : __props);
	const island_children = $derived(children);

	if (typeof window === 'undefined') {
		untrack(() => {
			const entry = nested
				? ''
				: is_island
					? island_entry
					: is_server
						? __hydrate
							? __module
							: ''
						: of_is_promise
							? '?'
							: of_init && of_init.kind === 'deferred'
								? of_init.module
								: '';
			const seed = !entry
				? false
				: entry === '?' || !region_reads_page(entry)
					? entry === '?'
						? 'all'
						: false
					: (region_page_keys(entry) ?? 'all');
			const remotes = !entry ? [] : entry === '?' ? null : region_remotes(entry);
			try {
				record_page(
					{ data: page.data, form: page.form, error: page.error, status: page.status },
					seed,
					remotes,
					entry === '?' ? '' : entry
				);
				// oxlint-disable-next-line ogygia/no-silent-failures -- an isolated render without a live page; the recorder is unset there anyway
			} catch {}
		});
	}

	const island_props_ready = $derived(
		island_inline ? island_props : prepare_region_props(island_props!)
	);

	const slot_id = next_slot_id(untrack(() => island_entry) ?? '', getContext(HOLE_SLOT_SEQUENCE));
	const has_slot_children = $derived(!nested && island_children != null);
	const slot_children = (renderer: { push(html: string): void }) => {
		renderer.push(slot_marker_open(slot_id));
		SlotBoundary(renderer as never, { children: island_children });
		renderer.push(SLOT_MARKER_CLOSE);
	};
	const island_props_body = $derived(
		has_slot_children && typeof window === 'undefined'
			? { ...island_props_ready, children: slot_children }
			: island_props_ready
	);
	const island_props_wire = $derived(
		has_slot_children
			? { ...island_props_ready, children: slot_pointer(slot_id) }
			: island_props_ready
	);
	const hydrate_attr = $derived(
		as_dual
			? as_dual.hydrate!
			: media
				? media
				: idle
					? 'idle'
					: visible
						? 'visible'
						: interaction
							? 'interaction'
							: 'load'
	);
	const root_margin = $derived(
		as_dual ? as_dual.hydrateMargin || undefined : typeof visible === 'string' ? visible : undefined
	);

	if (nested && (is_island || is_server) && import.meta.env && import.meta.env.DEV) {
		untrack(() => {
			if (is_server) warn('nested_server_island_inline', { entry: __entry || '' });
			else if (hydrate_attr !== nested_wake())
				warn('nested_island_with_parent', { entry: island_entry || '' });
		});
	}

	const island_module_url = $derived(nested || !island_entry ? '' : kit_asset(island_entry));
	const location_of = (identity: string) => {
		const found = identity ? entry_location(identity) : null;
		return found ? kit_asset(found) : '';
	};
	const island_src = $derived(nested || !island_entry ? '' : location_of(island_entry));

	const island_wire = $derived(
		nested || !is_island || island_inline ? null : new PropsWire(island_props_wire, island_entry)
	);
	const island_fp = $derived(
		island_wire ? region_fingerprint(island_module_url, island_wire.canonical) : ''
	);
	const outer_owner = typeof window === 'undefined' ? head_owner() : '';
	const tag_owner = outer_owner || (typeof window === 'undefined' ? untrack(() => island_fp) : '');
	if (!outer_owner && tag_owner) set_head_owner(tag_owner);
	const sheet_tags = (hrefs: string[]) => {
		const shared = tail
			? (href: string) => tail.sheet_owner(kit_asset(href), tag_owner)
			: undefined;
		let html = '';
		for (const href of claim_region_css(hrefs, tag_owner, shared) ?? [])
			html += region_css_tag(href, kit_asset(href), tag_owner);
		return html;
	};
	const island_skip = $derived(
		is_island &&
			!island_inline &&
			!has_slot_children &&
			(__cacheTtl ?? 0) <= 0 &&
			!!island_fp &&
			reuse_known_region(island_fp)
	);
	const island_props_tail =
		!!tail &&
		untrack(() => {
			const wire = island_wire;
			const fp = island_fp;
			if (!wire || !fp) return false;
			tail.props(fp, wire, {
				entry: island_entry,
				name: island_component?.name ?? '',
				module_url: island_src || island_module_url,
				wake: hydrate_attr,
				interactivity: region_interactivity(island_entry)
			});
			return true;
		});
	const island_props_inline = $derived(
		island_props_tail || !island_wire
			? ''
			: props_sidecar(island_fp, island_wire.wire(null), 'adjacent', island_wire.wire_modules)
	);

	function graph_hrefs(
		entry: string,
		self_url: string,
		live_entries: readonly string[] | null | undefined
	): string[] {
		const deps = region_deps(entry);
		if (!live_entries?.length) return deps.map((dep) => kit_asset(dep));
		const seen = new Set([self_url]);
		const hrefs: string[] = [];
		const add = (href: string) => {
			if (href && !seen.has(href)) {
				seen.add(href);
				hrefs.push(href);
			}
		};
		for (const dep of deps) add(kit_asset(dep));
		for (const m of live_entries) {
			add(location_of(m));
			for (const dep of region_deps(m)) add(kit_asset(dep));
		}
		return hrefs;
	}
	const island_live_locations = $derived.by(() => {
		const live = nested || !is_island ? null : island_wire?.live_entries;
		if (!live?.length) return null;
		const out: Map<string, string> = new Map();
		for (const m of live) {
			const loc = location_of(m);
			if (loc) out.set(m, loc);
		}
		return out.size ? out : null;
	});
	const island_graph_hrefs = $derived.by(() =>
		nested || !is_island || !island_module_url
			? []
			: graph_hrefs(island_entry, island_module_url, island_wire?.live_entries)
	);
	const island_kit_hint_hrefs = $derived(
		is_csr && hydrate_attr === 'load' && island_src ? [island_src, ...island_graph_hrefs] : []
	);
	const island_graph_tail =
		!!tail &&
		untrack(() => {
			if (island_live_locations) for (const [m, loc] of island_live_locations) tail.locate(m, loc);
			if (island_kit_hint_hrefs.length) tail.hints(island_kit_hint_hrefs, island_fp);
			else if (!is_csr && island_module_url) {
				const hrefs = tail.graph_of(island_module_url) ?? island_graph_hrefs;
				if (hrefs.length) tail.graph(island_module_url, hrefs, island_fp, island_src);
			}
			return true;
		});
	const island_preload_head = $derived(
		island_graph_tail
			? ''
			: island_kit_hint_hrefs.length
				? island_kit_hint_hrefs.map(modulepreload_tag).join('')
				: !is_csr && (island_graph_hrefs.length || island_live_locations)
					? island_graph_script(
							new Map([[island_module_url, island_graph_hrefs]]),
							island_live_locations
						)
					: ''
	);

	const server_endpoint = $derived.by(() => {
		if (!is_server || nested) return '';
		return (
			mint_server_region(__entry, __props || {}, __cacheTtl || 0, !!__hydrate) +
			kit_page_version(__entry)
		);
	});

	const server_region_entry = $derived(!nested && __module ? kit_asset(__module) : '');
	const server_region_src = $derived(!nested && __module ? location_of(__module) : '');

	const server_wire = $derived(nested || !__hydrate ? null : new PropsWire(__props, __entry));
	const server_props_script = $derived(
		server_wire
			? props_sidecar('', server_wire.wire(null), 'adjacent', server_wire.wire_modules)
			: ''
	);
	const server_identity = $derived(
		nested || !is_server ? '' : hole_identity(__entry as string, __props, server_wire)
	);
	const hole_attrs = () => {
		const a = (name: string, v: unknown) =>
			v == null || v === '' ? '' : ` ${name}="${escape_attr(String(v))}"`;
		return ` entry="${escape_attr(server_region_entry)}" render="defer"${a('stitch', __stitch)}${a('prefetch', __prefetch)}${a('when', __defer)}${a('wake', __hydrate)}${a('margin', __margin)}${a('hydrate-margin', __hydrateMargin)} endpoint="${escape_attr(server_endpoint)}"${a('data-og-hole', server_identity)}${a('src', server_region_src)}`;
	};
	const hole_adopt = adopt_region(
		hole_attrs,
		(renderer) => {
			if (ogygiaFallback) SlotBoundary(renderer, { children: ogygiaFallback } as never);
		},
		(el) => {
			if (el.firstChild || !ogygiaFallback) return;
			const app = mount(SlotBoundary, {
				target: el,
				props: { children: ogygiaFallback },
				context: region_contexts
			});
			// oxlint-disable-next-line ogygia/no-silent-failures -- unmount's promise is its outros ending; it never rejects
			return () => void unmount(app);
		}
	);
	const hole_frozen = adopt_region(
		() => {
			const identity = lake_identity(__entry || '', __props);
			return ` entry="${escape_attr(String(__entry || ''))}" wake="none" remount="cache"${identity ? ` data-og-lake="${identity}"` : ''}`;
		},
		(renderer) => {
			const Component = __component as unknown as (r: unknown, p: unknown) => void;
			if (Component)
				LakeBoundary(renderer, {
					children: (r: unknown) => Component(r, __props || {})
				} as never);
		}
	);
	const hole_css_html = $derived.by(() => {
		if (!is_server || !nested) return '';
		return sheet_tags(hole_css(__entry || ''));
	});
	if (tail && (is_csr || in_live_snippet) && is_server && !nested) {
		untrack(() => {
			const endpoint = server_endpoint;
			if (endpoint) tail.hole(server_identity, endpoint, server_props_script);
		});
	}
	if (tail && is_server && !nested)
		untrack(() =>
			tail.note_hole(
				__entry,
				__defer,
				__hydrate || null,
				__cacheTtl || 0,
				island_component?.name ?? '',
				__props,
				server_endpoint ? hole_copy_of(server_endpoint) : ''
			)
		);

	const server_graph_hrefs = $derived.by(() =>
		nested || !__module || !__hydrate || !server_region_entry
			? []
			: graph_hrefs(__module, server_region_entry, null)
	);
	if (typeof window === 'undefined' && is_server && !nested && !building)
		untrack(() => {
			if (__defer === 'load' && server_endpoint) note_early_hole(server_endpoint);
		});
	const server_graph_tail =
		!!tail &&
		untrack(() => {
			if (server_graph_hrefs.length) tail.graph(server_region_entry, server_graph_hrefs);
			return true;
		});
	const server_preload = $derived(
		server_graph_tail || !server_graph_hrefs.length
			? ''
			: island_graph_script(new Map([[server_region_entry, server_graph_hrefs]]))
	);

	const lake_inside = is_lake && nested;
	const lake_swr = $derived(__remount === 'swr');
	const lake_endpoint = $derived(
		lake_inside && lake_swr ? make_region_endpoint(__entry || '', __props || {}) : ''
	);
	const lake_attrs = $derived.by(() => {
		const esc = (v: unknown) => escape_attr(String(v));
		let s = ` entry="${esc(__entry || '')}" wake="none" remount="${esc(__remount)}"`;
		const identity = lake_identity(__entry || '', __props);
		if (identity) s = `${s} data-og-lake="${identity}"`;
		if (lake_swr) s = `${s} when="${esc(__when)}"`;
		if (__maxAge != null) s = `${s} max-age="${esc(String(__maxAge))}"`;
		if (__onExpire) s = `${s} on-expire="${esc(__onExpire)}"`;
		if (lake_swr && __margin) s = `${s} margin="${esc(__margin)}"`;
		if (lake_endpoint) s = `${s} endpoint="${esc(lake_endpoint)}"`;
		return s;
	});
	const lake_adopt = adopt_region(
		() => lake_attrs,
		(renderer) => LakeBoundary(renderer, { children } as never),
		(el) => {
			if (is_csr && !el.firstChild && import.meta.env && import.meta.env.DEV)
				warn('lake_mounted_without_html', { entry: __entry || '' });
		}
	);

	const runtime_script =
		!nested && ((is_island && !is_csr) || is_server || holds_live) && claimRuntimeEmit()
			? runtime_bootstrap(kit_asset) +
				(dev_hmr_url
					? `${LT}script type="module" data-ogygia-dev-hmr src="${kit_asset(dev_hmr_url)}"${GT}${LT}/script${GT}`
					: '')
			: '';
	const region_css_html = $derived.by(() => {
		if (!resolved || resolved.kind !== 'dual' || !resolved.module) return '';
		return sheet_tags(region_css(resolved.module));
	});
	const island_css_html = $derived.by(() => {
		if (__mode !== 'island' || !island_entry) return '';
		return sheet_tags(region_css(island_entry));
	});
	const kit_island_meta = $derived.by(() => {
		if (!is_island || !island_inline || !island_entry || !claim_kit_island(island_entry)) return '';
		const content = escape_amp_quot(String(island_entry));
		return `${LT}meta name="ogygia-kit-island" content="${content}"${head_owner_attr(tag_owner)}${GT}`;
	});

	const content_css_html = $derived.by(() => {
		if (resolved?.kind !== 'inline' || !resolved.content_id) return '';
		return sheet_tags(content_css(resolved.content_id));
	});

	const head_html = $derived(
		typeof window !== 'undefined'
			? ''
			: (is_island
					? runtime_script + island_preload_head + island_css_html + kit_island_meta
					: is_server
						? runtime_script + server_preload + hole_css_html
						: runtime_script) +
					region_css_html +
					content_css_html
	);

	const stringify_devalue = stringify;
	const baked_html = untrack(() =>
		__baked ? ((resolved as { html?: string } | undefined)?.html ?? '') : ''
	);
	let baked_el: Element | null = $state(null);
	const baked_adopt = adopt_region(
		() => (typeof window === 'undefined' ? ' live data-og-baked' : ' live'),
		(renderer) => (renderer as { push(html: string): void }).push(baked_html),
		(el) => {
			baked_el = el;
			return () => (baked_el = null);
		}
	);
	$effect(() => {
		if (baked_el) apply_live(baked_el as Element & { applyLive?: (v: unknown) => void });
	});
	function apply_live(node: Element & { applyLive?: (v: unknown) => void }) {
		const f = resolved;
		if (!f || f.kind !== 'deferred' || f.html == null) return;
		node.applyLive?.({
			id: f.id,
			module: f.module,
			props: f.props,
			html: f.html,
			url: f.url,
			hydrate: f.hydrate,
			hydrateMargin: f.hydrateMargin,
			written: written_order(f)
		});
	}
	function identity(f: DeferredRegion) {
		try {
			return `${f.id}\0${stringify_devalue(f.props)}`;
		} catch {
			return f.id;
		}
	}
	const held_props_script = $derived.by(() => {
		if (!resolved || resolved.kind !== 'deferred' || !resolved.hydrate || !resolved.url) return '';
		return props_sidecar('', { text: stringify_devalue(resolved.props), json: false });
	});
	if (DEVTOOLS && typeof window === 'undefined') {
		untrack(() => {
			try {
				if (is_island && !island_inline) {
					record_server_event({
						domain: 'server',
						name: 'server.region.rendered',
						fp: island_fp || '',
						mode: 'island',
						entry: island_module_url || undefined,
						propsBytes: island_wire?.canonical.length ?? 0
					});
					if (island_skip)
						record_server_event({
							domain: 'server',
							name: 'server.delta.skip',
							fp: island_fp || ''
						});
				} else if (is_server && !nested) {
					record_server_event({
						domain: 'server',
						name: 'server.region.rendered',
						fp: '',
						mode: 'server',
						entry: server_region_entry || undefined,
						propsBytes: server_wire?.canonical.length ?? 0
					});
				} else if (is_lake && lake_inside) {
					record_server_event({
						domain: 'server',
						name: 'server.region.rendered',
						fp: '',
						mode: 'lake',
						entry: __entry || undefined
					});
				}
				// oxlint-disable-next-line ogygia/no-silent-failures -- a devtools emit never breaks a render; the event is left out of the timeline
			} catch {}
		});
	}
</script>

<svelte:head><!-- svelte-ignore hydration_html_changed -->{@html head_html}</svelte:head>
{#if is_island}
	{@const Component = island_component}
	{#if island_inline}{#if Component}<Component {...island_props_ready}
				>{@render island_children?.()}</Component
			>{:else if late_load}<LateIsland
				load={late_load}
				props={island_props_ready!}
				children={island_children}
			/>{/if}{:else if island_skip}<ogygia-region
			entry={island_module_url}
			wake={hydrate_attr}
			margin={root_margin || undefined}
			data-ogygia-keep={__keep || undefined}
			data-og-fp={island_fp || undefined}
			data-og-skipped
			src={island_src || undefined}

		></ogygia-region><!-- svelte-ignore hydration_html_changed -->{@html island_props_inline}{:else}<ogygia-region
			entry={island_module_url}
			wake={hydrate_attr}
			margin={root_margin || undefined}
			data-ogygia-keep={__keep || undefined}
			data-og-fp={island_fp || undefined}
			src={island_src || undefined}><Component {...island_props_body} /></ogygia-region
		><!-- svelte-ignore hydration_html_changed -->{@html island_props_inline}{/if}
{:else if is_server}
	{@const Component = __component}
	{#if nested}{@render hole_frozen()}{:else if in_live_snippet || is_csr}{@render hole_adopt()}<!-- svelte-ignore hydration_html_changed -->{@html server_props_script}{:else}<ogygia-region
			entry={server_region_entry}
			render="defer"
			stitch={__stitch || undefined}
			prefetch={__prefetch || undefined}
			when={__defer}
			wake={__hydrate || undefined}
			margin={__margin || undefined}
			hydrate-margin={__hydrateMargin || undefined}
			endpoint={server_endpoint}
			data-og-hole={server_identity || undefined}
			src={server_region_src || undefined}
			>{#if ogygiaFallback}<SlotBoundary>{@render ogygiaFallback()}</SlotBoundary
				>{/if}</ogygia-region
		><!-- svelte-ignore hydration_html_changed -->{@html server_props_script}{/if}
{:else if is_lake}
	{#if is_csr || lake_inside}{@render lake_adopt()}{:else}
		{@render children?.()}
	{/if}
{:else if resolved?.kind === 'inline'}
	{@const Component = resolved.component}
	<Component {...resolved.props}
		>{#if children}{@render children()}{/if}</Component
	>
{:else if resolved?.kind === 'dual'}
	{@const Component = resolved.component}
	<Component {...resolved.props}
		>{#if children}{@render children()}{/if}</Component
	>
{:else if resolved?.html != null}
	{#if __baked}{@render baked_adopt()}{:else}<ogygia-region live {@attach apply_live}
			>{#if placeholder}{@render placeholder()}{:else if children}{@render children()}{/if}</ogygia-region
		>{/if}
{:else if resolved}
	{@const d = resolved as DeferredRegion}
	{#key identity(d)}
		<ogygia-region
			entry={d.module || ''}
			render="defer"
			when="load"
			wake={d.hydrate || undefined}
			hydrate-margin={d.hydrateMargin || undefined}
			endpoint={d.url}
			src={location_of(d.module || '') || undefined}
			>{#if placeholder}{@render placeholder()}{:else if children}{@render children()}{/if}</ogygia-region
		><!-- svelte-ignore hydration_html_changed -->{@html held_props_script}
	{/key}
{:else if of_is_promise}
	<PromiseRegion of={of as Promise<RegionValue>} {placeholder} {children} />
{/if}
