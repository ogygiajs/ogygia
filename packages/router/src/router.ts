import type { RequestEvent } from '@sveltejs/kit';
import type { Component } from 'svelte';
import { document } from '@ogygia/core/server';
import {
	region,
	registerRouteConfig as register_route_config,
	type RouteConfig,
	openLateScope as open_late_scope,
	takeLateRegions as take_late_regions,
	lateSlot as slot_html
} from '@ogygia/core/plugin';
import { componentCssHead as router_css_head } from '@ogygia/core/plugin/css';
import { request_scope } from '@ogygia/core/internal/server';
import { html, type StandardSchemaV1 } from '@ogygia/core/plugin/utils';
import LayoutChain from './LayoutChain.svelte';
import RawHtml from './RawHtml.svelte';
import { compile_all, match_path, fill, type CompiledPattern } from './match.ts';
import { make_ctx, type Ctx, type Visitor } from './ctx.ts';
import {
	compile_endpoint,
	is_page,
	to_load,
	type AnyComponent,
	type Endpoint,
	type EndpointDef,
	type LoadDef,
	type LoadInput,
	type PageDef,
	type KeyedTable,
	type PageHtmlView,
	type RouteTable,
	type TableShape
} from './define.ts';
import type { InferMap } from './infer.ts';
import type { HrefArgs } from './view.ts';
import {
	error,
	finalize,
	is_action_failure,
	is_http_error,
	is_redirect,
	json_response,
	method_not_allowed,
	not_found,
	options_response,
	redirect_response
} from './respond.ts';
import {
	is_stream_slot,
	bake_yield,
	stream_document,
	page_slot_chunks,
	late_region_chunks,
	merge_chunks,
	until_drained,
	PAGE_SLOT_ID
} from './stream.ts';

export interface RoutesOptions {
	/** Mount prefix, stripped before matching. Required for a library that owns a subtree. */
	base?: string;
	/** Trailing-slash policy. 'ignore' (default) matches both; 'never'/'always' 308-canonicalize. */
	slash?: 'ignore' | 'never' | 'always';
	/** Response for an unmatched path UNDER `base` (default: 404). Ignored without `base`. */
	miss?: (c: Ctx) => unknown;
	/** Root error boundary component (Kit's top `+error.svelte`) for thrown `error()` with no nearer
	 *  layout boundary. */
	error?: AnyComponent;
	/** A table-wide load run before EVERY route (pages and endpoints) — Kit's root `+layout.server.ts`
	 *  load without a component. The place for a guard with no shared chrome: it throws
	 *  `redirect`/`error` to gate, and its returned data merges into every page's `data` (outermost). */
	load?: LoadInput;
	/** WHO is this request? Derived ONCE here, read everywhere as `c.visitor` — experiments stick
	 *  on it, mounts sign it into claims, loads personalize with it. Signature-bound claims from
	 *  an upstream shell (fragment federation) take precedence over this resolver. */
	visitor?: (c: Ctx) => Visitor | undefined;
	/** Flags to PRE-DECIDE at the table, so mounts carry their buckets even when no page on this
	 *  server reads them (a shell that only ROUTES to teams still wants the visitor's world to
	 *  travel). Any flag a page DOES read auto-carries without being listed here — this is just for
	 *  the decide-but-don't-render case. `flags: [csr]`. */
	flags?: ReadonlyArray<(c: Ctx) => unknown>;
	/** Table-wide Kit `config` page option for every page (a layout's or a page's own key wins):
	 *  plugins read their keys from it (`{ postrender: false }`). The handle consults this table for
	 *  any request Kit's file router did not claim — keep `ogygia.handle()` ahead of the table in the
	 *  `sequence()` so a stored page is served before the table runs. */
	config?: RouteConfig;
}

/** The router value. `$infer` is a type-only phantom read as `typeof app.$infer`. */
export interface Router<T extends TableShape = RouteTable> {
	readonly __ogrouter: true;
	/** `(request) => Response | null` — null on no-match (a catchall 404s its own way). */
	fetch(request: Request, event?: RequestEvent): Promise<Response | null>;
	/** Kit handle: dispatches, else falls through to the rest of the app. */
	handle(input: {
		event: RequestEvent;
		resolve: (e: RequestEvent) => Response | Promise<Response>;
	}): Promise<Response>;
	/** Rename-safe URL to a route in this table. */
	href<P extends keyof T & string>(pattern: P, ...args: HrefArgs<P>): string;
	/** The catchall crawl list (static page routes) — `export const entries = app.entries`. */
	entries(): Promise<Array<{ path: string }>>;
	/** Type-only phantom map: `export type App = typeof app.$infer`. */
	readonly $infer: InferMap<T>;
}

interface Leaf {
	pattern: string;
	def: PageDef | EndpointDef;
	when?: (c: Ctx) => boolean;
}

/**
 * Flag-gate a table entry — page or endpoint. OFF means the route DOES NOT EXIST for that
 * request: 404 (the app's error page) under an owned `base`, fall-through to the rest of the app
 * without one. The gate is any `(c) => boolean` — a boolean `flag()` slots in directly, so a
 * staged rollout of a whole page, a beta route, or an endpoint kill switch is one wrapper:
 *
 *     '/checkout-v2': when(checkoutV2, page(NewCheckout, { load })),
 *     '/api/export':  when(exportsFlag, { GET: GET(export_csv) }),
 *     '/cms/[...rest]': when(cmsRollout, mount(cms)),          // per-cohort fragment rollout
 *
 * Decided AFTER `decide({ source })` primes, so a vendor kill switch gates routes too; the
 * decision self-registers for federation carry like any flag read. Type-transparent: `$infer`
 * sees the entry exactly as if unwrapped.
 */
export function when<T extends object>(gate: (c: Ctx) => boolean, entry: T): T {
	return { ...(entry as object), __ogwhen: gate } as unknown as T;
}

const HEAD_AS_GET = (m: string) => (m === 'HEAD' ? 'GET' : m);
const LAST_SLASH_RE = /\/$/;

/**
 * The router: a flat table of `pattern → page()` or endpoint values, with layouts wrapped around
 * page entries by `layout(...)(table)`. A request matches one entry. A page runs its loads at the
 * same time (each load once per request), merges their data outermost first, and renders through
 * its layouts; an endpoint runs its verb. `redirect()` and `error()` throw, `fail()` returns.
 * `typeof app.$infer` types the whole table.
 */
export function routes<const T extends KeyedTable<T>>(
	typed: T,
	opts: RoutesOptions = {}
): Router<T> {
	const table = typed as RouteTable;
	const base = (opts.base ?? '').replace(LAST_SLASH_RE, '');
	const slash = opts.slash ?? 'ignore';
	const root_load = to_load(opts.load);

	const seen_layout = new Map<string, AnyComponent>();
	for (const key in table) {
		const def = table[key];
		if (is_page(def)) {
			for (const l of def.layouts) {
				const prev = seen_layout.get(l.name);
				if (prev && prev !== l.component)
					throw new Error(
						`[@ogygia/router] two different layouts share the name ${JSON.stringify(l.name)} — names must be unique (they key App['(name)']).`
					);
				seen_layout.set(l.name, l.component);
			}
		}
	}

	const leaves: Leaf[] = Object.keys(table).map((pattern) => {
		const raw = table[pattern];
		// @why compile_endpoint drops `__ogwhen`, so an endpoint's gate is read off the raw entry (test: packages/federation/test/router-when.test.ts › endpoint: off → fall-through (null, no base); on via ?og-exp → served)
		const gate = (raw as { __ogwhen?: (c: Ctx) => boolean }).__ogwhen;
		return {
			pattern,
			def: is_page(raw) ? raw : compile_endpoint(raw as Endpoint),
			...(gate ? { when: gate } : {})
		};
	});
	const compiled: CompiledPattern[] = compile_all(leaves.map((l) => l.pattern));
	const by_pattern = new Map(leaves.map((l) => [l.pattern, l]));

	const NO_CONFIG: RouteConfig = {};
	const config_of = new Map<string, RouteConfig>();
	for (const leaf of leaves) {
		if (!is_page(leaf.def)) continue;
		let merged: Record<string, unknown> = { ...opts.config };
		for (const l of leaf.def.layouts) merged = { ...merged, ...l.config };
		config_of.set(leaf.pattern, { ...merged, ...leaf.def.config });
	}
	register_route_config(base + '|' + leaves.map((l) => l.pattern).join(','), (pathname) => {
		let path = pathname;
		if (base) {
			if (path === base) path = '/';
			else if (path.startsWith(base + '/')) path = path.slice(base.length);
			else return undefined;
		}
		path = canonical_slash(path, slash) ?? path;
		const hit = match_path(compiled, path);
		return hit ? (config_of.get(hit.pattern) ?? NO_CONFIG) : undefined;
	});

	const href_fn = (pattern: string, params?: Record<string, string | number>) =>
		base + fill(pattern, params ?? {});

	async function dispatch(request: Request, event?: RequestEvent): Promise<Response | null> {
		const url = new URL(request.url);
		let path = url.pathname;
		if (base) {
			if (path === base) path = '/';
			else if (path.startsWith(base + '/')) path = path.slice(base.length);
			else return null;
		}

		const canon = canonical_slash(path, slash);
		if (canon)
			return new Response(null, {
				status: 308,
				headers: { location: on_site(base + canon) + url.search }
			});

		const hit = match_path(compiled, path);
		const unmatched = async (): Promise<Response | null> => {
			if (base && opts.miss) {
				const ctx = make_ctx({}, url, request, event, href_fn, '', opts.visitor);
				try {
					return finalize(await opts.miss(ctx));
				} catch (thrown) {
					if (is_redirect(thrown)) return redirect_response(thrown.status, thrown.location);
					if (is_http_error(thrown))
						return json_response(
							{ error: thrown.message, status: thrown.status },
							{ status: thrown.status }
						);
					throw thrown;
				}
			}
			if (base && opts.error && (request.method === 'GET' || request.method === 'HEAD')) {
				const accept = request.headers.get('accept') ?? '';
				if (accept.includes('text/html')) {
					const ctx = make_ctx({}, url, request, event, href_fn, '', opts.visitor);
					const of = region(LayoutChain as never, {
						chain: [],
						component: opts.error,
						props: { status: 404, error: { message: 'Not found' }, data: {}, params: {} },
						data: {}
					});
					return document(of, {
						status: 404,
						head: await router_css_head([opts.error]),
						pageState: {
							url: ctx.url,
							params: {},
							route: { id: null },
							status: 404,
							data: {},
							error: { message: 'Not found' }
						}
					});
				}
			}
			if (base) return not_found();
			return null;
		};
		if (!hit) return unmatched();

		const leaf = by_pattern.get(hit.pattern)!;
		const ctx = make_ctx(hit.params, url, request, event, href_fn, hit.pattern, opts.visitor);
		if (opts.flags) for (const f of opts.flags) f(ctx);
		if (leaf.when && !leaf.when(ctx)) return unmatched();

		// @why Kit's setHeaders reaches only resolve()-built responses, and the router builds its own (test: packages/router/test/router-dispatch.test.ts › applies collected headers to the built response)
		const with_collected = (res: Response): Response => {
			if (ctx.collected_headers?.size) {
				for (const [k, v] of ctx.collected_headers) {
					if (!res.headers.has(k)) res.headers.set(k, v);
				}
			}
			return res;
		};

		try {
			if (root_load) {
				const rl = await root_load(ctx);
				if (rl instanceof Response) return with_collected(rl);
			}
			if ((leaf.def as { __ogkind?: string }).__ogkind === 'endpoint')
				return with_collected(await run_endpoint(leaf.def as EndpointDef, ctx, request.method));
			return with_collected(await render_page(leaf.def as PageDef, ctx, request.method, url));
		} catch (thrown) {
			return with_collected(await handle_thrown(thrown, leaf.def, ctx));
		}
	}

	async function render_page(node: PageDef, ctx: Ctx, method: string, url: URL): Promise<Response> {
		const m = HEAD_AS_GET(method);

		if (node.params_schema) {
			const v = await validate(node.params_schema, ctx.params);
			if (v.issues) return not_found();
			(ctx as { params: unknown }).params = v.value;
		}
		if (node.search_schema) {
			const v = await validate(node.search_schema, ctx.search);
			if (v.issues)
				return json_response({ error: 'Invalid query', issues: v.issues }, { status: 400 });
			(ctx as { search: unknown }).search = v.value;
		}

		let form: unknown;
		let status = 200;

		if (m === 'POST') {
			const act = pick_action(node, url);
			if (!act) return method_not_allowed(page_allow(node));
			const out = await act(ctx);
			if (out instanceof Response) return out;
			if (is_action_failure(out)) {
				form = out.data;
				status = out.status;
			} else {
				form = out ?? undefined;
			}
		} else if (m !== 'GET') {
			if (method === 'OPTIONS') return options_response(page_allow(node));
			return method_not_allowed(page_allow(node));
		}

		// @why no waterfall: a branch's loads run together (test: packages/router/test/router-dispatch.test.ts › the layouts’ and the page’s loads all run before any of them ends (no waterfall))
		const load_defs: (LoadDef | undefined)[] = [
			root_load,
			...node.layouts.map((l) => l.load),
			node.load
		];
		const results = await Promise.all(load_defs.map((l) => (l ? l(ctx) : undefined)));
		const data: Record<string, unknown> = {};
		for (const r of results) {
			if (r instanceof Response) return r;
			if (r && typeof r === 'object') Object.assign(data, r);
		}

		const chain = node.layouts.map((l) => l.component);
		let gen_rest: AsyncGenerator<unknown> | null = null;
		let gen_first_html: string | null = null;
		if (is_stream_slot(node.component)) {
			const it = (
				node.component as unknown as (c: Ctx, d: Record<string, unknown>) => AsyncGenerator<unknown>
			)(ctx, data);
			const first = await it.next();
			if (first.done) error(500, 'a streamed page must yield at least one region');
			if (m === 'GET' && method !== 'HEAD') {
				gen_first_html = await bake_yield(first.value);
				gen_rest = it;
			} else {
				let last = first.value;
				for (;;) {
					const n = await it.next();
					if (n.done) break;
					last = n.value;
				}
				gen_first_html = await bake_yield(last);
			}
		}

		const resolved =
			gen_first_html !== null
				? { __oghtml: true as const, html: slot_html(PAGE_SLOT_ID, gen_first_html) }
				: typeof node.component === 'object' &&
					  node.component !== null &&
					  '__ogpick' in node.component
					? (
							node.component as { __ogpick: (c: Ctx, data: Record<string, unknown>) => unknown }
						).__ogpick(ctx, data)
					: node.component;
		const html_view =
			typeof resolved === 'object' && resolved !== null && '__oghtml' in resolved
				? (resolved as PageHtmlView)
				: null;
		const page_component = html_view ? (RawHtml as AnyComponent) : (resolved as AnyComponent);
		if (html_view?.status && html_view.status >= 400) status = html_view.status;
		const of = region(LayoutChain as never, {
			chain,
			component: page_component,
			props: html_view ? { html: html_view.html } : { data, form, params: ctx.params },
			data,
			fallback: node.fallback
		});
		const css_head =
			(await router_css_head(html_view ? chain : [...chain, page_component])) +
			(html_view
				? (html_view.title ? String(html`<title>${html_view.title}</title>`) : '') +
					(html_view.css?.join('') ?? '') +
					(html_view.head ?? '')
				: '');
		if (m === 'GET') open_late_scope();
		const res = await document(of, {
			status,
			head: css_head,
			pageState: {
				url: ctx.url,
				params: ctx.params,
				route: { id: ctx.route.id || null },
				status,
				data,
				form
			}
		});
		if (method === 'HEAD') return new Response(null, res);
		const late = take_late_regions();
		const chunk_src =
			gen_rest && late?.length
				? merge_chunks(page_slot_chunks(gen_rest), late_region_chunks(late))
				: gen_rest
					? page_slot_chunks(gen_rest)
					: late?.length
						? late_region_chunks(late)
						: null;
		if (chunk_src && m === 'GET')
			return stream_document(
				await res.text(),
				res,
				until_drained(chunk_src, take_late_regions),
				PAGE_SLOT_ID,
				request_scope(ctx.request)
			);
		return res;
	}

	async function handle_thrown(
		thrown: unknown,
		def: PageDef | EndpointDef,
		ctx: Ctx
	): Promise<Response> {
		if (is_redirect(thrown)) return redirect_response(thrown.status, thrown.location);
		if (is_action_failure(thrown)) return json_response(thrown.data, { status: thrown.status });
		if (!is_http_error(thrown)) throw thrown;

		const { status, message } = thrown;
		if ((def as { __ogkind?: string }).__ogkind === 'endpoint')
			return json_response({ error: message, status }, { status });
		const pnode = def as PageDef;

		// @why an error page renders only inside layouts whose loads ended well; the memoized loads, awaited again, name the one that failed (test: packages/router/test/router-dispatch.test.ts › a layout load’s error skips that layout’s own error page: the one above renders, without the failed layout)
		const load_defs: (LoadDef | undefined)[] = [
			root_load,
			...pnode.layouts.map((l) => l.load),
			pnode.load
		];
		const settled = await Promise.allSettled(
			load_defs.map(async (l) => (l ? await l(ctx) : undefined))
		);
		let failing = settled.length;
		for (let i = 0; i < settled.length; i++) {
			if (settled[i].status === 'rejected') {
				failing = i;
				break;
			}
		}
		const renderable = failing === 0 ? 0 : Math.min(failing - 1, pnode.layouts.length);
		const data: Record<string, unknown> = {};
		for (const s of settled) {
			if (
				s.status === 'fulfilled' &&
				s.value &&
				typeof s.value === 'object' &&
				!(s.value instanceof Response)
			)
				Object.assign(data, s.value);
		}

		let boundary = -1;
		for (let i = renderable - 1; i >= 0; i--) {
			if (pnode.layouts[i].error) {
				boundary = i;
				break;
			}
		}
		const err_component = boundary >= 0 ? pnode.layouts[boundary].error! : opts.error;
		if (!err_component) return json_response({ error: message, status }, { status });

		const chrome = (boundary >= 0 ? pnode.layouts.slice(0, boundary + 1) : []).map(
			(l) => l.component
		);
		const of = region(LayoutChain as never, {
			chain: chrome,
			component: err_component,
			props: { status, error: { message }, data, params: ctx.params },
			data
		});
		const css_head = await router_css_head([...chrome, err_component]);
		return document(of, {
			status,
			head: css_head,
			pageState: {
				url: ctx.url,
				params: ctx.params,
				route: { id: ctx.route.id || null },
				status,
				data,
				error: { message }
			}
		});
	}

	const self: Router<T> = {
		__ogrouter: true,
		fetch: dispatch,
		handle: async ({ event, resolve }) => {
			const r = await dispatch(event.request, event);
			return r ?? resolve(event);
		},
		href: ((pattern: string, params?: Record<string, string | number>) =>
			href_fn(pattern, params)) as Router<T>['href'],
		async entries() {
			const out: Array<{ path: string }> = [];
			for (const leaf of leaves) {
				if (!is_page(leaf.def)) continue;
				if (!leaf.pattern.includes('[')) {
					out.push({ path: base + leaf.pattern });
					continue;
				}
				const list = leaf.def.entries ? await leaf.def.entries() : null;
				if (list) for (const params of list) out.push({ path: base + fill(leaf.pattern, params) });
			}
			return out;
		},
		get $infer(): never {
			throw new Error('router.$infer is a type-only phantom — read `typeof app.$infer`.');
		}
	};
	return self;
}

async function run_endpoint(node: EndpointDef, ctx: Ctx, method: string): Promise<Response> {
	const m = HEAD_AS_GET(method);
	const allow = [...node.methods.keys()];
	if (method === 'OPTIONS' && !node.methods.has('OPTIONS')) return options_response(allow);
	const e = node.methods.get(m);
	if (!e) return method_not_allowed(allow);
	if (e.bodySchema) {
		let body: unknown = undefined;
		const ct = ctx.request.headers.get('content-type') ?? '';
		if (ct.includes('application/json')) {
			try {
				body = await ctx.request.clone().json();
			} catch {
				return json_response({ error: 'Invalid JSON body' }, { status: 400 });
			}
		}
		const v = await validate(e.bodySchema, body);
		if (v.issues)
			return json_response({ error: 'Invalid body', issues: v.issues }, { status: 400 });
		(ctx as { input: unknown }).input = v.value;
	}
	return finalize(await e.handler(ctx));
}

async function validate(
	schema: StandardSchemaV1,
	input: unknown
): Promise<
	{ value: unknown; issues?: undefined } | { issues: Array<{ message: string; path?: unknown }> }
> {
	const r = await schema['~standard'].validate(input);
	if (r.issues) return { issues: r.issues.map((i) => ({ message: i.message, path: i.path })) };
	return { value: r.value };
}

const TRAILING_SLASH = /\/+$/;
const LEADING_SLASHES = /^[/\\]+/;
/** A redirect target that stays on this site: exactly one leading `/` and no `\` (test:
 *  router-dispatch.test.ts › the trailing-slash redirect stays on the site). */
function on_site(path: string): string {
	return '/' + path.replace(LEADING_SLASHES, '').replaceAll('\\', '%5C');
}
function canonical_slash(path: string, mode: 'ignore' | 'never' | 'always'): string | null {
	if (mode === 'ignore' || path === '/') return null;
	const has = path.endsWith('/');
	if (mode === 'never' && has) return path.replace(TRAILING_SLASH, '') || '/';
	if (mode === 'always' && !has) return path + '/';
	return null;
}

function pick_action(node: PageDef, url: URL): ((c: Ctx) => unknown) | undefined {
	const actions = node.actions;
	if (!actions) return undefined;
	for (const key of url.searchParams.keys()) {
		if (key.startsWith('/')) {
			const named = actions[key.slice(1)];
			if (named) return named;
		}
	}
	return actions.default;
}
function page_allow(node: PageDef): string[] {
	const a = ['GET', 'HEAD'];
	if (node.actions && Object.keys(node.actions).length) a.push('POST');
	return a;
}

export type { Component };
