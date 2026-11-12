import { routes, page, error, type Ctx, type PageDef, type Router } from '@ogygia/router';
import type { Analysis } from './analyze.ts';
import type { ReportExtras, ReportMeta, RequestEntry, RouteAgg } from './report.ts';
import type { StoredReport, SampledSummary, TrapStatus } from './index.ts';
import Dashboard from './ui/Dashboard.svelte';
import Report from './ui/Report.svelte';
import Run from './ui/Run.svelte';
import Login from './ui/Login.svelte';
import Upload from './ui/Upload.svelte';
import Message from './ui/Message.svelte';
import Compare from './ui/Compare.svelte';
import Site from './ui/Site.svelte';
import type { Comparison } from './compare.ts';
import type { SinkRow } from './sink.ts';

/** One page's profile history: every page-mode report of it, oldest first, by median run. */
export interface PageHistory {
	page: string;
	points: { id: string; created: number; median: number; score?: number }[];
}

/** What the router calls into the host for. Return types here ARE the components' `data` types. */
export interface ProfilerDeps {
	base: string;
	/** Table-wide guard: a deny Response short-circuits every route (v2 load-returns-Response), else
	 *  `undefined` = allow. The load below turns allow into the seeded `{ base }`. */
	auth_guard(c: Ctx): Promise<Response | undefined>;
	/** The runtime's hydration beacon (POST, authed): browser-side island timings, joined by fingerprint. */
	beacon(c: Ctx): Promise<Response>;
	/** A recording window you start and stop (POST, authed): the server's CPU, calls and requests
	 *  while a test (or the devtools Record tab) drives the app; stop answers the report's JSON. */
	window_start(c: Ctx): Promise<Response>;
	window_stop(c: Ctx): Promise<Response>;
	/** Is this request logged in? The public bare report page gates its SERVER data on this (a share
	 *  `#fragment` renders without it). */
	authed(c: Ctx): Promise<boolean>;
	dashboard(c: Ctx): {
		base: string;
		recent: RequestEntry[];
		routes: RouteAgg[];
		/** the request tag the slowest-routes table is split by (`?by=tenant`), when any */
		by: string | null;
		/** every tag key seen in the log (`tag()`), for the split-by control */
		tag_keys: string[];
		reports: ReportMeta[];
		/** report id → its biggest slow pattern (what to fix first) and how many more it found */
		top_fix: Record<string, { title: string; save_ms: number; wait: boolean; more: number }>;
		/** the lines that slow two or more profiled pages, what fixing each gives back per page and in all */
		site_fixes: import('./site-fixes.ts').SiteFix[];
		/** the holes the server rendered: render, cache, and who held the render slots others waited for */
		holes: import('./hole-slots.ts').HoleSlots | null;
		recording: boolean;
		dev: boolean;
		rss_mb: number;
		inflight: number;
		/** page-mode reports grouped by page (the history sparklines + compare pairs) */
		history: PageHistory[];
		/** the trap (catch the slow one), when configured */
		trap: TrapStatus | null;
		/** the always-on sampler's rolling hot-functions table, when configured */
		sampled: SampledSummary | null;
		/** why the background recorders are off (a serverless host), when they are */
		background_note: string | null;
	};
	/** Two stored reports side by side. `cmp` is null when this server no longer holds one of the reports: the page then compares
	 *  from the browser's store (the ids come back so it can) */
	compare(
		a: string | undefined,
		b: string | undefined
	): { base: string; cmp: Comparison | null; a: string; b: string };
	/** the whole-site pictures: this instance's rows, the sink's status, a URL the browser reads rows from */
	site(c: Ctx): {
		base: string;
		rows: SinkRow[];
		sink: {
			url: string;
			last: { at: number; ok: boolean; rows: number; error?: string } | null;
			buffered: number;
		} | null;
		from: string | null;
		ephemeral: boolean;
	};
	/** A caught request profiled again in full page mode with the inputs it was caught with. */
	replay(id: string | undefined, c: Ctx): Promise<Response>;
	/** DEV ONLY: a few lines of a local source file around a line (the row's source peek). */
	source(c: Ctx): Promise<Response>;
	run_page(
		c: Ctx
	): Response | { base: string; path: string; runs: number; format: string; against?: string };
	record_page(c: Ctx): Promise<Response>;
	reset(c: Ctx): Response;
	/** A tiny live-status poll for the sidebar (and, later, a hosted dashboard): is a recording
	 *  running right now, how many requests are in flight, the instance's memory, how many reports
	 *  this instance holds. Cheap and side-effect-free. */
	status(c: Ctx): { recording: boolean; inflight: number; rss_mb: number; reports: number };
	/** `session_problem`: why a login that just succeeded still has no session (null otherwise). */
	login_props(c: Ctx): { base: string; next: string; session_problem: string | null };
	login(c: Ctx): Promise<Response>;
	logout(c: Ctx): Promise<Response>;
	upload(c: Ctx): Promise<Response>;
	report_stored(id: string | undefined): StoredReport | undefined;
	/** Like `report_stored`, but falls through to the configured storage backend (SQLite/Redis/
	 *  Postgres) on a memory miss and reconstructs the report from its stored dump — so a report
	 *  survives the instance that made it. Memory-only when no store is configured. */
	report_load(id: string | undefined): Promise<StoredReport | undefined>;
	/** The reports the backend holds (summaries), for the sidebar's shared list. Empty with no store. */
	list_stored(
		limit?: number
	): Promise<{ id: string; label: string; page?: string; created: number }[]>;
	/** The login page for THIS url (`?next=` back here) when the UI is secret-gated; null when a
	 *  login makes no sense (dev is open; no secret = no UI). */
	login_url(c: Ctx): string | null;
	report_view(stored: StoredReport): Promise<{
		a: Analysis;
		meta: ReportMeta;
		base: string;
		extras: ReportExtras;
		ogpB64?: string;
		/** this page's other page-mode reports (page mode only) and the one just before this */
		history: PageHistory | null;
		prev: string | null;
		/** against the previous profile of this page, when this server still holds it */
		since: import('./compare.ts').Since | null;
		/** recorded on a dev server — the source peek is available */
		dev: boolean;
	}>;
	report_json(stored: StoredReport): Response | Promise<Response>;
	report_dump_json(stored: StoredReport): Response;
	/** ONE self-contained HTML file of the report (styles, runtime and island chunks inlined) —
	 *  opens from disk with the islands live. A built app only; dev answers 400. */
	report_html(stored: StoredReport, c: Ctx): Promise<Response>;
	/** A report's standalone file, agent JSON or plain dump, built from the report the request
	 *  carries (the page's .ogp bytes or the browser's kept copy): works on any instance. */
	report_posted(c: Ctx, as: 'html' | 'json' | 'dump' | 'ogp'): Promise<Response>;
	report_raw(stored: StoredReport): Promise<Response>;
}

async function report_or_404<R>(
	d: ProfilerDeps,
	id: string | undefined,
	fn: (s: StoredReport) => R
): Promise<Awaited<R>> {
	const s = await d.report_load(id);
	if (!s) error(404, 'That report has expired.');
	return await fn(s);
}

type CtxFn<R> = (c: Ctx) => R;
type ProfilerPage<Load, Actions = unknown> = PageDef<readonly [], Load, Actions, unknown, unknown>;

/**
 * Build the profiler router. Auth is the table-wide `load`: a redirect or deny short-circuits every
 * route (the hydration beacon and the recording window too); on allow it seeds `{ base }`.
 *
 * - `/report/[id]` gives the server's report only to a logged-in visitor (else anyone could read
 *   reports by guessing ids); a guest gets the share-link gate, which decrypts a `#fragment` in the
 *   browser. A guest never reaches the storage backend. When this server holds the report in
 *   memory, the gate says so and offers the login: the visitor is most likely its owner on a fresh
 *   browser.
 * - Its `.json`, `.html`, `.dump` and `/raw` files GET the stored report by id (a thrown 404 once it
 *   expired). `.json`, `.html`, `.dump` and `.ogp` also take a POST that carries the report (the
 *   page's .ogp bytes or the browser's kept copy), which any instance can answer: on a serverless
 *   host the only kind of request that finds the report at all.
 */
export function build_profiler_router(d: ProfilerDeps): Router<{
	readonly '/': ProfilerPage<(c: Ctx) => ReturnType<ProfilerDeps['dashboard']>>;
	readonly '/run': ProfilerPage<(c: Ctx) => ReturnType<ProfilerDeps['run_page']>>;
	readonly '/page': { readonly GET: CtxFn<Promise<Response>> };
	readonly '/reset': { readonly GET: CtxFn<Response> };
	readonly '/status.json': { readonly GET: CtxFn<Response> };
	readonly '/beacon': { readonly POST: CtxFn<Promise<Response>> };
	readonly '/window/start': { readonly POST: CtxFn<Promise<Response>> };
	readonly '/window/stop': { readonly POST: CtxFn<Promise<Response>> };
	readonly '/login': ProfilerPage<
		(c: Ctx) => ReturnType<ProfilerDeps['login_props']>,
		{ default: CtxFn<Promise<Response>> }
	>;
	readonly '/logout': { readonly GET: CtxFn<Promise<Response>> };
	readonly '/view': ProfilerPage<() => { base: string }, { default: CtxFn<Promise<Response>> }>;
	readonly '/reports.json': { readonly GET: CtxFn<Promise<Response>> };
	readonly '/report/[id]': ProfilerPage<
		(c: Ctx) => Promise<
			| {
					report: Awaited<ReturnType<ProfilerDeps['report_view']>>;
					base: string;
					login: null;
					exists: boolean;
			  }
			| { report: null; base: string; login: string | null; exists: boolean }
		>
	>;
	readonly '/report/[id].json': {
		readonly GET: CtxFn<Promise<Response>>;
		readonly POST: CtxFn<Promise<Response>>;
	};
	readonly '/report/[id].html': {
		readonly GET: CtxFn<Promise<Response>>;
		readonly POST: CtxFn<Promise<Response>>;
	};
	readonly '/report/[id].dump': {
		readonly GET: CtxFn<Promise<Response>>;
		readonly POST: CtxFn<Promise<Response>>;
	};
	readonly '/report/[id].ogp': { readonly POST: CtxFn<Promise<Response>> };
	readonly '/report/[id]/raw': { readonly GET: CtxFn<Promise<Response>> };
	readonly '/compare/[a]/[b]': ProfilerPage<(c: Ctx) => ReturnType<ProfilerDeps['compare']>>;
	readonly '/replay/[id]': { readonly GET: CtxFn<Promise<Response>> };
	readonly '/site': ProfilerPage<(c: Ctx) => ReturnType<ProfilerDeps['site']>>;
	readonly '/source': { readonly GET: CtxFn<Promise<Response>> };
}> {
	return routes(
		{
			'/': page(Dashboard, { load: (c) => d.dashboard(c) }),
			'/run': page(Run, { load: (c) => d.run_page(c) }),
			'/page': { GET: (c) => d.record_page(c) },
			'/reset': { GET: (c) => d.reset(c) },
			'/status.json': { GET: (c) => c.json(d.status(c)) },
			'/beacon': { POST: (c) => d.beacon(c) },
			'/window/start': { POST: (c) => d.window_start(c) },
			'/window/stop': { POST: (c) => d.window_stop(c) },
			'/login': page(Login, {
				load: (c) => d.login_props(c),
				actions: { default: (c) => d.login(c) }
			}),
			'/logout': { GET: (c) => d.logout(c) },
			'/view': page(Upload, {
				load: () => ({ base: d.base }),
				actions: { default: (c) => d.upload(c) }
			}),
			'/reports.json': { GET: async (c) => c.json(await d.list_stored()) },
			'/report/[id]': page(Report, {
				load: async (c) => {
					const stored = (await d.authed(c))
						? await d.report_load(c.params.id)
						: d.report_stored(c.params.id);
					if (stored && (await d.authed(c)))
						return { report: await d.report_view(stored), base: d.base, login: null, exists: true };
					return { report: null, base: d.base, login: d.login_url(c), exists: !!stored };
				}
			}),
			'/report/[id].json': {
				GET: (c) => report_or_404(d, c.params.id, d.report_json),
				POST: (c) => d.report_posted(c, 'json')
			},
			'/report/[id].html': {
				GET: (c) => report_or_404(d, c.params.id, (s) => d.report_html(s, c)),
				POST: (c) => d.report_posted(c, 'html')
			},
			'/report/[id].dump': {
				GET: (c) => report_or_404(d, c.params.id, d.report_dump_json),
				POST: (c) => d.report_posted(c, 'dump')
			},
			'/report/[id].ogp': {
				POST: (c) => d.report_posted(c, 'ogp')
			},
			'/report/[id]/raw': {
				GET: (c) => report_or_404(d, c.params.id, d.report_raw)
			},
			'/compare/[a]/[b]': page(Compare, { load: (c) => d.compare(c.params.a, c.params.b) }),
			'/replay/[id]': { GET: (c) => d.replay(c.params.id, c) },
			'/site': page(Site, { load: (c) => d.site(c) }),
			'/source': { GET: (c) => d.source(c) }
		},
		{
			base: d.base,
			error: Message,
			load: async (c) => (await d.auth_guard(c)) ?? { base: d.base },
			miss: () => error(404, 'Unknown profiler page.')
		}
	);
}

/** The whole profiler route tree as a typed `path → { data, params, form, search }` map — components index it. */
export type ProfilerRoutes = ReturnType<typeof build_profiler_router>['$infer'];
