/**
 * The drop-in, production-safe SSR profiler for SvelteKit. Configured ENTIRELY in
 * vite.config.ts — never wired in hooks:
 *
 *     ogygia({ profiler: true })          // or { profiler: { secret, path, … } }
 *
 * `ogygia.handle()` reads that config (through the plugins' server halves,
 * `ogygia:server/server-plugins`) and dynamically imports + mounts this internally, so hooks.server.ts stays
 * a plain `sequence(...)`. This module is NOT a public entry point — it is reached
 * only through the handle's lazy import.
 *
 * What you get, with zero per-component wrapping:
 *
 * - Always on (free in production): wall time + CPU per request, per-route p50/p95.
 *   Outbound-network attribution and Server-Timing headers are always on in DEV; in
 *   production they exist only while a profile is being recorded (page-mode or the
 *   `x-profile` header) — an idle request runs in no AsyncLocalStorage and pays nothing.
 * - On demand: a V8 sampling CPU profile of the live server. Svelte compiles
 *   every component to a function named after its file, so the profile
 *   attributes SSR time to components by itself.
 * - Network attribution: `fetch` and `http/https` are patched (call-through)
 *   and every outbound call is tied to the request that made it.
 * - Memory: RSS/heap sampling during recordings plus a heap allocation
 *   profile ("who allocates the most").
 *
 * Visit `<path>` (default /__profiler) — in prod, log in (or send the x-profiler-key header).
 * All state lives in memory; nothing is written to disk.
 */

import type { RequestEvent } from '@sveltejs/kit';
import { mac_hex, mac_key, random_id, same_key, same_text } from './key-check.ts';
import type { Handle } from '@ogygia/core/plugin';
import {
	analyze,
	analyze_heap,
	learn_script_urls,
	categorize,
	chunk_component_renamer,
	heap_by_component,
	sourcemap_resolver,
	another_routes_file,
	type Analysis,
	type CallFrame,
	type CpuProfile,
	type ProfileNode,
	type FrameCategory,
	type FrameStat,
	type HeapAllocator,
	type HeapNode,
	type SourceMapResolver
} from './analyze.ts';
import { route_dirs as route_folders } from './route-files.ts';
import type { CallerSite, NetCall, NetContext } from './net.ts';
import { TRACE_HEADER, encode_trace } from './net.ts';
import type { IoOp } from './async-io.ts';
import {
	report_json,
	report_dump,
	is_dump,
	type MemSample,
	type ReportExtras,
	type ReportMeta,
	type RequestEntry,
	type RouteAgg
} from './report.ts';
import { ogp_encode, ogp_decode, is_ogp, recover_ogp_bytes, OGP_MAX_UNPACKED } from './crypto.ts';
import {
	AFTER_LOGIN_PARAM,
	SESSION_COOKIE,
	describe_cookie_diagnosis,
	raw_cookie_values,
	session_cookie_values,
	type CookieDiagnosis
} from './session-cookie.ts';

/** Set on the login page's URL when a login just succeeded and the session still did not arrive. */
const LOGIN_FAILED_PARAM = 'session';
/** The origin a login's `next` is read against: one it keeps never names another. */
const SAME_ORIGIN = 'http://same.origin';
/** A region entry's id prefix on the dev server (core's ids.ts `islandVirtualId`). */
const REGION_ENTRY_ID = 'ogygia:region/entry/';
import {
	derive_findings,
	island_rows_of,
	own_requests,
	island_host_renamer,
	island_name,
	path_template,
	page_score_of,
	type ClientIslandStat,
	type ClientMarkStat,
	type PageVitals
} from './report.ts';
import { load_lane_of } from './timeline.ts';
import { parse_visit, merge_visits, type Visit } from './visit.ts';
import { MAX_VISITS_PER_KEY } from './storage/visits.ts';
import { hole_slots } from './hole-slots.ts';
import {
	client_windows,
	interaction_windows,
	type ClientWindows,
	type InteractionCpu
} from './client-windows.ts';
import { byte_strip, page_seed, type ByteStrip } from './byte-strip.ts';
import { stream_tail } from './stream-tail.ts';
import {
	weigh_assets,
	assets_diff,
	type PageAssets,
	type Weight,
	type AssetRef
} from '@ogygia/insights';
import { BEACON_STANDALONE_TAG } from './beacon-tag.ts';
import { is_document_request } from '../document-request.ts';
import { build_river, load_return_keys, seed_key_bytes, type River } from './river.ts';
import { SinkBuffer, type SinkRow } from './sink.ts';
import {
	attribute_gc,
	heap_sites,
	gc_kind,
	type AllocSite,
	type AllocSlice,
	type GcAttribution,
	type GcEvent
} from './gc.ts';
import type { Retained, RetainedSite } from './insights.ts';
import { alloc_timeline, type AllocTimeline, type HeapSample } from './alloc.ts';
import { contention, type Contention } from './contention.ts';
import {
	build_lineage,
	data_reads,
	data_prop_names,
	whole_read_line,
	type Lineage
} from './lineage.ts';
import { build_ledger, pkg_of, type LedgerLine } from './ledger.ts';
import { at_line, build_drill, call_group, tag_fills, type DrillNode } from './drill.ts';
import { forecast_of, type Forecast } from './forecast.ts';
import { OgygiaError, warn } from '../messages/runtime.ts';
import { site_fixes } from './site-fixes.ts';
import { may_be_chunk, module_category, module_lookup } from './module-map.ts';
import {
	embedded_files,
	embedded_chunk,
	embedded_map_of,
	embedded_source,
	load_embedded_maps
} from './embedded-maps.ts';
import { module_imports, route_imports } from './route-imports.ts';
import { app_relative } from './app-path.ts';
import { fnv1a32 } from '@ogygia/core/plugin/utils';
import {
	head_end,
	mark_personal,
	MIN_SECRET_BYTES,
	RateLimiter,
	read_capped
} from '@ogygia/core/internal/server';
import { attr_sites, doc_diff } from './doc-diff.ts';
import { almost_same_document_pattern } from './patterns.ts';
import { hydration_hazards } from '@ogygia/insights';
import type { IslandHazard } from './report.ts';
import {
	constant_work,
	each_blocks,
	formatter_rewrite,
	hoist_plan,
	key_sources,
	late_island_keys,
	line_rw,
	load_inputs,
	names_on,
	parent_use,
	tokens,
	type FormatterRewriteOptions
} from './source-scan.ts';
import {
	find_cold_caches,
	find_patterns,
	find_same_answers,
	find_wait_patterns,
	heap_growth,
	is_clear_leak,
	is_flat,
	late_island_pattern,
	render_per_item_pattern,
	same_document_pattern,
	same_work_pattern,
	seed_whole_pattern,
	stable_answers,
	varied_answers,
	wait_save_on_path,
	counted_sync_io,
	type ConstantWork,
	type HeapGrowth,
	type LateIslandWait,
	type PerItemRender,
	type Pattern,
	type WaitCall,
	type WholeReader
} from './patterns.ts';

/** I/O resources a line can wait on one after another, as a readable target. Timers and ticks
 *  are left out: a timer awaited per turn is the `yield-per-item` pattern, read from the code. */
const WAIT_TARGET: Record<string, string> = {
	FSREQCALLBACK: 'file access',
	FSREQPROMISE: 'file access',
	GETADDRINFOREQWRAP: 'DNS lookup',
	GETNAMEINFOREQWRAP: 'DNS lookup',
	QUERYWRAP: 'DNS query',
	TCPCONNECTWRAP: 'socket connect',
	PIPECONNECTWRAP: 'pipe connect'
};

/** A response body read chunk by chunk, each chunk's end offset stamped with when it arrived
 *  (ms after `t0`): the byte strip's "left the server at". */
async function read_timed(
	res: Response,
	t0: number
): Promise<{ text: string; chunks: { end: number; t: number }[] }> {
	const reader = res.body?.getReader();
	if (!reader) return { text: await res.text(), chunks: [] };
	const dec = new TextDecoder();
	let text = '';
	const chunks: { end: number; t: number }[] = [];
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		text += dec.decode(value, { stream: true });
		if (chunks.length < 4000) chunks.push({ end: text.length, t: round2(performance.now() - t0) });
	}
	text += dec.decode();
	return { text, chunks };
}
import {
	compare_reports,
	island_files_diff,
	page_history,
	vitals_moved,
	type Since
} from './compare.ts';
import { engine_of, vital_parts, type ChunkBarrel, type PageInput } from '@ogygia/insights';
import { label_call, phase_of_frame } from './timeline.ts';
import { gzip_large } from './compress.ts';
import { io_kind, mark_left_each_run } from './async-io.ts';
import {
	current_request_scope,
	request_scope,
	type BatchHoleStats
} from '@ogygia/core/internal/server';
import {
	hole_stats_of,
	install_request_stats,
	request_stats_of,
	set_batch_hole_listener,
	hold_request_stats_detail
} from './request-stats.ts';
import {
	chunk_barrels,
	chunk_contents,
	chunk_duplicates,
	chunk_heavy,
	region_hazards,
	region_page_keys,
	region_page_why
} from 'ogygia:server';
import { set_span_recorder, type SpanAttrs, type SpanRecord, type SpanRecorder } from './span.ts';
import type { WindowIds } from './window-id.ts';
import {
	flights,
	clock,
	lock,
	machine,
	noop,
	outbox,
	policy,
	registry,
	scope,
	STALE,
	type Flights,
	type LockToken,
	type Outbox,
	type Scope
} from '@ogygia/machine';
import { register_profiler_file } from './frames.ts';
import { devtools_app } from '../app.ts';

/** One post of sink rows: its id (the sink may drop a copy by it), its NDJSON, and its row count. */
type SinkPost = { id: string; body: string; rows: number };
/** A sink post out: settles once it (and the post of the rows read meanwhile, when `again`) ended. */
type SinkOut = { again: boolean; done: Promise<void> };
/** How a sink post is tried again: a sink restarting is ridden out, and a sink that is down costs
 *  each post 30 s at most, so the posts after it are not held long. */
const SINK_POLICY = /* @__PURE__ */ policy({
	attempts: 4,
	backoff: [1000, 5000, 10_000],
	jitter: 0.2,
	deadline: 30_000
});
/** The longest one try at a post waits for the sink's answer. */
const SINK_TRY_MS = 5000;
const error_text = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
// The span recorder's `begin` lives in this file: skip its frame when finding a span's caller.
register_profiler_file();
import { error, type Router, type Ctx as RouteCtx } from '@ogygia/router';
import { app_asset_rel, client_dir_candidates, client_file_finder } from './client-files.ts';
import { isHttpError as is_http_error, isRedirect as is_redirect } from '@ogygia/router';
import { build_profiler_router } from './profiler-router.ts';
import { detect_dev } from './env.ts';
import { refresh_target } from './refresh-stub.ts';

export interface ProfilerOptions {
	/**
	 * Auth secret. Defaults to the OGYGIA_PROFILER_SECRET env var. Required outside
	 * dev — with no secret in production the profiler UI is disabled (the
	 * always-on request log still collects, invisibly).
	 */
	secret?: string;
	/** Base path for the UI. Default '/__profiler'. */
	path?: string;
	/** Sampling interval in microseconds for recordings. Default 500. */
	sampleInterval?: number;
	/** How many finished profiles to keep in memory (each gzipped). Default 6. */
	maxReports?: number;
	/** How many requests the rolling log keeps. Default 500. */
	recentRequests?: number;
	/**
	 * Patch fetch/http to attribute outbound calls. Default true. In production the
	 * per-request AsyncLocalStorage that does the attributing exists only while a profile
	 * is being recorded (idle requests pay nothing); in dev it is always on. Set false to
	 * skip the global fetch/http patch entirely: wall timing only, never any network view.
	 */
	network?: boolean;
	/**
	 * Add Server-Timing headers to every response. These expose internal render
	 * and network timings to every client, so the default is ON in dev and OFF
	 * in production — set true to force it on.
	 */
	serverTiming?: boolean;
	/** Take a heap allocation profile during recordings. Default true. */
	heap?: boolean;
	/** Master switch. Default true. */
	enabled?: boolean;
	/**
	 * DEMAND-ONLY. The profiler module (node:inspector, crypto, its UI-rendering path) is not imported,
	 * parsed or initialised until a request actually hits the profiler path — so until you open the
	 * dashboard the app pays EXACTLY what an app with no profiler pays: no cold-start import, no
	 * always-on request log, no per-request wrap. The trade is no history: the profiler starts
	 * collecting from the first visit onward, not before. Recommended on serverless (Amplify / Lambda),
	 * where every cold start would otherwise pay the profiler's import on its TTFB. Default false (the
	 * profiler mounts on the first request and its always-on log collects from boot). Off by default so
	 * nothing changes for existing setups.
	 */
	onDemand?: boolean;
	/**
	 * CATCH THE SLOW ONE. Keep a coarse sampler running in rolling windows and keep a report only
	 * when a request in the window took longer than `over` ms — the p99 request you cannot
	 * reproduce. Built to stay cheap: a 10 ms sampling interval, no per-request context, no stack
	 * capture, no heap sampling; the request is matched to the window by time. Off by default; off
	 * on serverless hosts (an instance dies before it catches anything). Stops after `keep` reports.
	 */
	trap?: {
		over: number;
		interval?: number;
		window?: number;
		keep?: number;
		/** request headers to KEEP with a caught request so "profile it again" can replay it with the
		 *  same inputs (`['accept-language', 'x-tenant']`). Never cookies unless named here. */
		replay?: string[];
	};
	/**
	 * A CPU PROFILE IN THE BROWSER for the profiler's own user: their documents get the
	 * `Document-Policy: js-profiling` header, the runtime samples the main thread while the page
	 * hydrates (Chromium's JS Self-Profiling API) and posts the trace through the beacon; the report
	 * shows it as components, functions and a flame graph for hydration. Default true; a visitor is
	 * never sampled (no tag, no policy, no profiler).
	 */
	clientCpu?: boolean;
	/**
	 * THE SINK — for a host whose instances live seconds (Amplify, Lambda). Each instance posts what
	 * it saw as NDJSON to this URL before it dies: one small row per request, one summary per
	 * always-on sampler window, a caught request's dump. `key` goes as a bearer token (default: the
	 * profiler secret). A long-lived host posts every `every` ms (default 10 s); a serverless one
	 * posts after each request. The site view (`<base>/site`) reads the rows back from any URL you
	 * serve them from: the request cloud and the layer cake of the whole site, over days.
	 */
	sink?: { url: string; key?: string; every?: number };
	/**
	 * ALWAYS-ON SAMPLING. Every `every` seconds take one `window` ms coarse sample (10 ms interval)
	 * and fold it into a rolling "hot functions over the last hour" table on the dashboard. The
	 * accuracy comes from volume, not from one capture. Default off; off on serverless.
	 */
	sample?: { every?: number; window?: number; interval?: number };
	/**
	 * WHERE REPORTS LIVE. Default: this instance's memory (lost on restart; each browser keeps its
	 * own copies). Not a `devtools({ profiler })` option: a store is a live object the build-time
	 * options cannot carry, so the app sets it at runtime with `setProfilerStore(store)` from
	 * `@ogygia/devtools/profiler/storage`, in hooks.server.ts, and the server half passes it in here
	 * when the profiler mounts. A store is `new SqliteStore(…)`, `new RedisStore(…)` or `new PostgresStore(…)`
	 * from `@ogygia/devtools/profiler/storage/{sqlite,redis,postgres}`, or your own; every finished
	 * report is written there and read back from there, so it survives the instance that made it and
	 * a whole team shares one list. The store is dual-written: memory stays the hot cache, the store
	 * the source of truth.
	 */
	store?: import('./storage/index.ts').ProfilerStore;
}

/** One always-on sampling window's fold: the hot functions and how much time it covered. */
interface SampledWindow {
	at: number;
	ms: number;
	busy_ms: number;
	functions: {
		key: string;
		name: string;
		url: string;
		line: number;
		category: FrameCategory;
		pkg?: string;
		self_ms: number;
	}[];
}
/** The dashboard's always-on view. */
export interface SampledSummary {
	every_s: number;
	window_ms: number;
	windows: number;
	since: number | null;
	sampled_ms: number;
	busy_ms: number;
	functions: {
		key: string;
		name: string;
		url: string;
		line: number;
		category: FrameCategory;
		pkg?: string;
		self_ms: number;
		windows: number;
	}[];
}

/** The dashboard's trap view. */
export interface TrapStatus {
	over: number;
	window_ms: number;
	caught: number;
	keep: number;
	/** `armed`: it waits for or takes its next window; `stopped`: a window failed (the dashboard's
	 *  note says why); `done`: it kept all it was asked to, or is not armed yet */
	state: 'armed' | 'done' | 'stopped';
}

/** One visit's web vitals from the runtime's beacon (ms; CLS unitless). */
interface VitalsSample {
	ttfb?: number;
	fcp?: number;
	lcp?: number;
	cls?: number;
	inp?: number;
	/** the visit it came from (its navigation start, epoch ms): a later message of the same visit
	 *  REPLACES the sample (the early visit, then the final one on hide) instead of counting twice */
	at?: number;
}
const MAX_VITALS_PATHS = 200;
const MAX_VITALS_SAMPLES = 30;
const MAX_SAMPLED_WINDOWS = 60;
const SAMPLED_FUNCTIONS_PER_WINDOW = 150;

interface UserTiming {
	name: string;
	count: number;
	total_ms: number;
	max_ms: number;
}

interface GcSummary {
	count: number;
	total_ms: number;
	max_ms: number;
}

export interface StoredReport {
	meta: ReportMeta;
	analysis: Analysis;
	heap: HeapAllocator[] | null;
	/** bytes per component from the same heap sample */
	heap_components?: { name: string; bytes: number }[] | null;
	net: NetCall[];
	spans?: SpanRecord[];
	mem: MemSample[];
	measures: UserTiming[];
	gc: GcSummary | null;
	io: IoOp[];
	call_counts: Record<string, number>;
	/** the raw .cpuprofile, gzipped — a 10s profile is multiple MB of JSON, so
	 * we keep it compressed (~10×) and inflate only on download */
	raw: Buffer | string;
	/** bytes per island module / preload href (page mode on a built app) */
	weights?: Record<string, number>;
	/** what is inside each of those chunks (the build's handoff), for the same hrefs */
	contents?: Record<string, string[]>;
	heavy?: Record<string, { total: number; top: { name: string; bytes: number }[] }>;
	barrels?: Record<string, ChunkBarrel[]>;
	/** each island entry's lines that draw differently in the browser (its own `.svelte` sources) */
	hazards?: Record<string, IslandHazard[]>;
	/** browser hydration timings carried by an uploaded dump (a live report joins the ring instead) */
	client?: ClientIslandStat[];
	/** the page's web vitals carried by an uploaded dump */
	vitals?: PageVitals;
	/** the app's browser marks carried by an uploaded dump */
	client_marks?: ClientMarkStat[];
	/** a caught request's inputs, so it can be profiled again in full */
	replay?: { path: string; headers: Record<string, string> };
	/** the browser's CPU profile of hydration carried by an uploaded dump */
	client_cpu?: { analysis: Analysis; at: number; sample_ms: number; windows?: ClientWindows };
	/** the slowest interaction's CPU (its wait, its handlers) carried by an uploaded dump */
	interaction_cpu?: InteractionCpu;
	/** the browser's picture of a visit to this page (the beacon), the latest at report time */
	visit?: Visit;
	/** the rendered document as a byte strip (page mode: the last run's body) */
	strip?: ByteStrip;
	/** every file the document loads at start, weighed (page mode on a build) */
	assets?: PageAssets;
	/** why the page was not weighed (a dev server) */
	assets_missing?: string;
	/** the data river (page mode): calls → loads → keys → islands */
	river?: River;
	/** who caused the GC: each pause joined to the allocations before it (gc.ts) */
	gc_attr?: GcAttribution;
	/** promises created in the window (count, sampled creators) */
	promises?: { count: number; top: { caller: string; share: number }[] };
	/** what one more render left alive after a full collection, by allocation site */
	retained?: Retained;
	/** when the heap grew and what ran then (alloc.ts) */
	alloc?: AllocTimeline;
	/** the other requests the instance answered while the render ran (contention.ts) */
	contention?: Contention;
	/** which component reads which page.data key, from the sources (lineage.ts) */
	lineage?: Lineage;
	/** the app lines that cost the most, every cost joined per line (ledger.ts) */
	ledger?: LedgerLine[];
	/** the known slow shapes found on those lines, grouped (patterns.ts) */
	patterns?: Pattern[];
	/** one render's time as a tree that adds up: phase → owner / call → line (drill.ts) */
	drill?: DrillNode;
	/** one render after every fix named, estimated without counting a saving twice (forecast.ts) */
	forecast?: Forecast;
	/** a few more renders with a full collection after each: does the heap keep growing? */
	growth?: HeapGrowth;
}

/** One island fingerprint's browser-side samples (the runtime's hydration beacon). */
interface BeaconAgg {
	entry: string;
	/** wake → data-hydrated, ms */
	ms: number[];
	/** the module-load part, ms */
	load: number[];
	/** hydrations that discarded the server DOM and re-rendered (a mismatch) */
	recovered: number;
	/** the named first divergence from the most recent recovery — the "why" (see hydrate-core) */
	reason?: string;
	last: number;
}
const MAX_BEACON_FPS = 2000;
const MAX_BEACON_SAMPLES = 64;
const MAX_BEACON_BODY = 64 * 1024;
const MAX_BEACON_CPU_BODY = 6 * 1024 * 1024;
const MAX_BEACON_VISIT_BODY = 512 * 1024;
/** a login form: a key and a `next` path (test/profiler-body-cap.test.ts, #1150) */
const MAX_LOGIN_BODY = 16 * 1024;
/** an uploaded .ogp or a posted report, packed (a real one is a few MB) */
const MAX_POSTED_REPORT = 32 * 1_048_576;
/** the allocation sampler's interval while attributing GC: coarse on purpose (64 KB, against the
 *  16 KB the allocators table used) — the attribution needs shares, not every object, and every
 *  sample is a record V8 keeps until the read */
const GC_SAMPLING_BYTES = 65536;
/** the live-objects sampler of the memory passes after the timed runs (what one render keeps, and
 *  the growth check): finer, because those are VERDICTS on a line, not shares. At 64 KB a 1 MB
 *  cache entry is ~14 samples, and a 4-entry cache's halfway-to-end ratio swung 1.10–2.00 around
 *  its true 1.33 (the leak line is 1.85): the slow-patterns decoy read "grows" 1 run in ~17, and a
 *  real leak was missed now and then. At 16 KB it stays 1.16–1.57. These renders are not timed:
 *  it costs about half a second of the profile's wall time on the heaviest test page, no timing. */
const LIVE_SAMPLING_BYTES = 16384;
/** the fine heap series (alloc.ts): the timer's period and the most samples one window keeps */
const HEAP_SERIES_PERIOD_MS = 20;
const HEAP_SERIES_MAX = 2000;
/** the sampler keeps objects already collected: the ALLOCATION stream, what drives the collector,
 *  not just what is still alive when the profile is read */
const GC_SAMPLING_FLAGS = {
	includeObjectsCollectedByMajorGC: true,
	includeObjectsCollectedByMinorGC: true
};
/** how long a page profile waits for a background window (trap / sampler) to finish — the
 *  longest such window is the trap's 5 s */
const PAGE_WAITS_FOR_BACKGROUND_MS = 8000;
/** a started window stops itself after this, even with no stop (it holds the recorder) */
const WINDOW_MAX_MS = 60_000;
/** the header a test's driver sends with each request of a window (its signed id) */
const WINDOW_HEADER = 'x-og-window';
/** a window's requests sit in the store's visit rows under this page key (never a real path) */
const WINDOW_PAGE_PREFIX = '\0window:';
const MAX_VISITS_PER_PAGE = 5;
/** a screen narrower than this is a phone's (its own first screen, its own hidden islands) */
const NARROW_SCREEN_PX = 768;
/** Svelte's client runtime, by the names that show up under a component while it hydrates */
/** the package in a CDN script's path: `/npm/@scope/name@8/dist/x.js`, `/name@1.2.3/x.js`, `/gh/user/repo@v/` */
const CDN_PKG_RE = /\/(?:npm\/)?((?:@[\w.-]+\/)?[\w.-]+)@[\w.^~-]+\//;
const SVELTE_CLIENT_FN_RE =
	/^(?:set_text|set_attribute|set_class|set_style|template|from_html|child|sibling|first_child|append|mount|hydrate|hydrate_template|each|if_block|render_effect|template_effect|effect|derived|proxy|get|set|push|pop|init|reset|next|skip_nodes|create_text|remove_nodes|event|delegate|bind_value|component|snippet|slot|head)$/;

/**
 * Chromium's JS Self-Profiling trace (`Profiler.stop()`) as a V8 cpuprofile: a stack is a chain of
 * frames, so every distinct stack becomes one node whose parent is its parent stack; the samples
 * are timestamps (ms) → time deltas (µs); a sample with no stack is idle. Bounded (samples,
 * stacks); `null` for anything not shaped like a trace. Exported for the tests.
 */
export function self_profile_to_cpuprofile(trace: unknown): CpuProfile | null {
	const t = trace as {
		resources?: unknown;
		frames?: unknown;
		stacks?: unknown;
		samples?: unknown;
	};
	if (!t || !Array.isArray(t.frames) || !Array.isArray(t.stacks) || !Array.isArray(t.samples))
		return null;
	const resources = Array.isArray(t.resources)
		? (t.resources as unknown[]).map((r) => (typeof r === 'string' ? r : ''))
		: [];
	const frames = (
		t.frames as { name?: unknown; resourceId?: unknown; line?: unknown; column?: unknown }[]
	).slice(0, 50_000);
	const stacks = (t.stacks as { frameId?: unknown; parentId?: unknown }[]).slice(0, 100_000);
	const samples = (t.samples as { timestamp?: unknown; stackId?: unknown }[]).slice(0, 200_000);
	const frame_of = (i: number): CallFrame => {
		const f = frames[i];
		if (!f) return { functionName: '(unknown)', url: '', lineNumber: 0, columnNumber: 0 };
		const rid = typeof f.resourceId === 'number' ? f.resourceId : -1;
		return {
			functionName: typeof f.name === 'string' ? f.name : '',
			url: rid >= 0 ? (resources[rid] ?? '') : '',
			lineNumber: typeof f.line === 'number' ? Math.max(0, f.line - 1) : 0,
			columnNumber: typeof f.column === 'number' ? Math.max(0, f.column - 1) : 0
		};
	};
	// node ids: 1 = (root), 2 = (idle), stack i → i + 3
	const nodes: ProfileNode[] = [
		{
			id: 1,
			callFrame: { functionName: '(root)', url: '', lineNumber: 0, columnNumber: 0 },
			children: [2]
		},
		{ id: 2, callFrame: { functionName: '(idle)', url: '', lineNumber: 0, columnNumber: 0 } }
	];
	const children = new Map<number, number[]>([[1, [2]]]);
	for (let i = 0; i < stacks.length; i++) {
		const s = stacks[i];
		const fid = typeof s?.frameId === 'number' ? s.frameId : -1;
		const parent =
			typeof s?.parentId === 'number' && s.parentId >= 0 && s.parentId < stacks.length
				? s.parentId + 3
				: 1;
		nodes.push({ id: i + 3, callFrame: frame_of(fid) });
		(children.get(parent) ?? children.set(parent, []).get(parent)!).push(i + 3);
	}
	for (const n of nodes) {
		const ch = children.get(n.id);
		if (ch?.length) n.children = ch;
	}
	const sample_ids: number[] = [];
	const deltas: number[] = [];
	let last: number | null = null;
	let first = 0;
	for (const s of samples) {
		const ts = typeof s?.timestamp === 'number' ? s.timestamp : null;
		if (ts === null) continue;
		if (last === null) first = ts;
		const sid =
			typeof s?.stackId === 'number' && s.stackId >= 0 && s.stackId < stacks.length
				? s.stackId + 3
				: 2;
		sample_ids.push(sid);
		deltas.push(last === null ? 0 : Math.max(0, Math.round((ts - last) * 1000)));
		last = ts;
	}
	if (!sample_ids.length) return null;
	return {
		nodes,
		startTime: Math.round(first * 1000),
		endTime: Math.round((last ?? first) * 1000),
		samples: sample_ids,
		timeDeltas: deltas
	};
}
const MAX_BEACON_ISLANDS = 400;
/** the tag the runtime looks for: its content is the beacon endpoint */
const BEACON_META = 'ogygia-profiler-beacon';
/** an island fingerprint: 8–32 lowercase hex chars, checked without a regex (per beacon sample) */
function is_hex_id(s: string): boolean {
	if (s.length < 8 || s.length > 32) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
	}
	return true;
}

/** A report's fetch of one of the app's files, through the app (`signal`: the weigh gave up). */
type FetchUrl = (url: string, signal?: AbortSignal) => Promise<Response>;
/** What one weigh is handed: the URL (its key), and the fetch of the report that asked. */
type WeighAsk = { url: string; fetch_url: FetchUrl };
/** Bytes per asset URL (`null`: the file is not there), measured once per process: a hashed
 *  asset never changes. */
type UrlWeights = Flights<WeighAsk, number | null, Pick<WeighAsk, 'url'>>;

/** A status that says the file is not there for good: a client error, but not a timeout or a
 *  rate limit (408, 429), which say "not now". */
const gone_for_good = (status: number): boolean =>
	status >= 400 && status < 500 && status !== 408 && status !== 429;

/** The process's URL weights: an answer (bytes, or a file that is not there) is kept; a failure
 *  (a 5xx, a timeout, the network) is not, so the next report asks again. Reports weighing the
 *  same file at once share one fetch. */
export const url_weights = (): UrlWeights =>
	flights.keyed<WeighAsk>()({
		name: 'profiler url weights',
		key: ['url'],
		ignore: { fetch_url: 'every report fetches the same hashed file through the app' },
		run: async ({ url, fetch_url }, signal) => {
			const res = await fetch_url(url, signal);
			if (!res.ok) {
				void res.body?.cancel().catch(noop); // ok: only the status is read
				if (gone_for_good(res.status)) return null;
				throw new Error(`status ${res.status}`);
			}
			const len = Number(res.headers.get('content-length'));
			// content-length is the wire size; the body's own length is the decoded size — the
			// bytes the browser parses. Read it when it is not already known to be identity.
			const enc = res.headers.get('content-encoding');
			if (!enc && Number.isFinite(len) && len > 0) {
				void res.body?.cancel().catch(noop); // ok: the length is known
				return len;
			}
			return (await res.arrayBuffer()).byteLength;
		}
	});

/** GET each URL through the app's own fetch and count its bytes — the JS weight of an island's
 *  closure. Kept per process (`url_weights`), a handful at a time, capped in time so a slow static
 *  host can never hold a report hostage: a URL not weighed within the budget is left out. */
export async function weigh_urls(
	urls: Iterable<string>,
	fetch_url: FetchUrl,
	weights: UrlWeights,
	budget_ms = 4000
): Promise<Record<string, number>> {
	const todo = [...new Set(urls)].filter((u) => u);
	const budget = AbortSignal.timeout(budget_ms);
	const out: Record<string, number> = {};
	let i = 0;
	const worker = async () => {
		while (i < todo.length && !budget.aborted) {
			const url = todo[i++];
			try {
				const bytes = await weights.get({ url, fetch_url }, { signal: budget });
				if (typeof bytes === 'number') out[url] = bytes;
			} catch {
				// ok: not weighed this time (a 5xx, the network); left out, and the next report asks again
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
	return out;
}

const percentile = (sorted: number[], p: number) =>
	sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

function summarize_measures(entries: { name: string; ms: number }[]): UserTiming[] {
	const by_name = new Map<string, UserTiming>();
	for (const e of entries) {
		let t = by_name.get(e.name);
		if (!t) by_name.set(e.name, (t = { name: e.name, count: 0, total_ms: 0, max_ms: 0 }));
		t.count++;
		t.total_ms += e.ms;
		if (e.ms > t.max_ms) t.max_ms = e.ms;
	}
	return [...by_name.values()]
		.map((t) => ({ ...t, total_ms: round2(t.total_ms), max_ms: round2(t.max_ms) }))
		.sort((a, b) => b.total_ms - a.total_ms)
		.slice(0, 30);
}

interface Ctx extends NetContext {
	entry: RequestEntry;
	net: NetCall[];
	/** this request's spans (`span()` from ogygia/profiler), capped like `net` */
	spans: SpanRecord[];
	/** the span the current code runs inside (a child store per `span.within`), for nesting */
	span?: number;
}

const MAX_SPANS_PER_REQUEST = 2000;
const MAX_WINDOW_SPANS = 20_000;
const MAX_TAGS = 16;

/** The span recorder one recording window installs (`span()` / `tag()` from ogygia/profiler): every
 *  span the window sees, nested through the request's async context, or through the window's own
 *  store where no request is attributed. */
class WindowSpans implements SpanRecorder {
	/** every span recorded during the window, any request */
	readonly spans: SpanRecord[] = [];
	#seq = 0;
	#als: import('node:async_hooks').AsyncLocalStorage<Ctx> | null;
	#span_als: import('node:async_hooks').AsyncLocalStorage<number>;
	#netmod: typeof import('./net.ts') | null;

	constructor(
		als: import('node:async_hooks').AsyncLocalStorage<Ctx> | null,
		span_als: import('node:async_hooks').AsyncLocalStorage<number>,
		netmod: typeof import('./net.ts') | null
	) {
		this.#als = als;
		this.#span_als = span_als;
		this.#netmod = netmod;
	}

	begin(name: string, attrs?: SpanAttrs): SpanRecord {
		const ctx = this.#als?.getStore();
		const parent = ctx?.span ?? this.#span_als.getStore();
		const rec: SpanRecord = {
			id: ++this.#seq,
			name: String(name).slice(0, 120),
			start: performance.now(),
			ms: -1,
			...(attrs ? { attrs: { ...attrs } } : {}),
			...(parent !== undefined ? { parent } : {}),
			caller_site: this.#netmod?.nearest_app_site(),
			route: ctx?.route ?? null,
			path: ctx?.path ?? null
		};
		if (this.spans.length < MAX_WINDOW_SPANS) this.spans.push(rec);
		if (ctx && ctx.spans.length < MAX_SPANS_PER_REQUEST) ctx.spans.push(rec);
		return rec;
	}

	within<T>(s: SpanRecord, fn: () => T): T {
		const als = this.#als;
		const ctx = als?.getStore();
		return ctx && als ? als.run({ ...ctx, span: s.id }, fn) : this.#span_als.run(s.id, fn);
	}

	end(s: SpanRecord, attrs?: SpanAttrs, error?: unknown): void {
		s.ms = round2(performance.now() - s.start);
		if (attrs) s.attrs = { ...s.attrs, ...attrs };
		if (error !== undefined) {
			s.error = error instanceof Error ? error.message : String(error);
		}
	}

	tag(key: string, value: string): void {
		const ctx = this.#als?.getStore();
		if (!ctx) return;
		const tags = (ctx.entry.tags ??= {});
		if (key in tags || Object.keys(tags).length < MAX_TAGS) tags[key] = value;
	}
}
/** the process's live profiler (the newest): an older one's background timers stand down */
const LIVE_PROFILER = Symbol.for('ogygia.profiler.live');

interface WindowCapture {
	profile: CpuProfile;
	heap: HeapNode | null;
	mem: MemSample[];
	net: NetCall[];
	/** every span recorded during the window (`span()`), any request */
	spans: SpanRecord[];
	gc_pauses: number[];
	/** each GC pause with its time on the profile's clock, kind and flags (who caused it: gc.ts) */
	gc_events: GcEvent[];
	/** allocation slices read from the sampling heap profiler while the window ran */
	gc_slices: AllocSlice[];
	gc_dict: Record<string, AllocSite>;
	io_ops: IoOp[];
	/** promises created in the window and who created them (a sampled attribution; `site` is the
	 *  generated position, mapped and dropped when the report is built) */
	promises?: { count: number; top: { caller: string; share: number; site?: CallerSite }[] };
	call_counts: Record<string, number>;
	measures: UserTiming[];
	loop?: { p50: number; p99: number; max: number };
	cpu_percent?: number;
	elu_percent?: number;
	t0: number;
	t1: number;
	duration_ms: number;
	/** performance.now() right after `Profiler.start` — puts the samples on the net/io clock */
	perf_start: number;
	/** the ONE request the report's timeline explains (page mode: the representative run; request
	 *  mode: the request), performance.now() ms; absent for a plain window */
	window?: { start: number; end: number };
	/** page mode: every run's window, for the per-run component split */
	runs?: { start: number; end: number }[];
	/** page mode: renders another visitor of the same page overlapped, left out (their samples set
	 *  aside by time) */
	set_aside?: { start: number; end: number }[];
	/** the used heap sampled finely, on the capture's clock (full windows) */
	heap_series?: HeapSample[];
}

const MAX_NET_PER_REQUEST = 100;
const MAX_WINDOW_NET = 2000;
const MAX_BACKGROUND_NET = 300;
// A recording that started longer ago than this is treated as abandoned (a frozen/timed-out
// serverless invocation whose cleanup never ran), so the profiler unwedges itself. Kept just above
// the hard cap below so a legit run never trips it, but a truly wedged one self-heals fast — while a
// recording is active EVERY request on the site runs inside the attribution AsyncLocalStorage, so a
// stuck run is a site-wide tax until this elapses.
const RECORDING_MAX_MS = 35_000;
// The absolute wall-time a single page recording may run, even on a real server with no gateway kill.
// A hung upstream on the profiled page must never keep the site-wide attribution context alive: past
// this the run is abandoned, its state cleared, and the request returns. Well above a legit multi-run
// recording (5 renders of a 3 s page + coverage ≈ 20 s); on serverless the platform budget is smaller
// and wins.
const RECORDING_HARD_CAP_MS = 30_000;
// One render (a warm-up hop or a run) that outlives this is treated as hung: the recording stops
// waiting on it and finishes with what it has, rather than pinning the whole recording — and the site —
// on a page whose own upstream never returns.
const PER_RENDER_TIMEOUT_MS = 15_000;

/**
 * What the recorder's owner records (the process's one inspector and attribution context). Its
 * lock says who owns it; this says how: `background` (the trap, the sampler, a started window: a
 * request is matched to it by time, and runs in no request context) or `recording` (a page profile
 * or a header-profiled request: every request is attributed). A recording still running past the
 * hard cap is `cut`: it keeps the inspector until it ends, but the site stops paying for its
 * attribution context.
 */
const recorder_machine = machine<{
	free: {};
	background: { token: LockToken; since: number };
	recording: { token: LockToken; since: number };
	cut: { token: LockToken; since: number };
}>()({
	name: 'profiler-recorder',
	initial: 'free',
	steps: {
		free: ['background', 'recording'],
		background: ['free'],
		recording: ['free', 'cut'],
		cut: ['free']
	},
	after: {
		recording: {
			ms: RECORDING_HARD_CAP_MS + 2_000,
			to: 'cut',
			data: (s) => ({ token: s.token, since: s.since })
		}
	}
});

/** A stopped window's answer, shared by every stop of it (a retried stop gets the same report). */
type WindowAnswer = { status: number; body: unknown };

/**
 * A window you start and stop. `recording` lasts at most WINDOW_MAX_MS (a stop that never comes);
 * leaving it, however, ends the capture's work. `stopping` makes the report, and holds the
 * recorder until it is made.
 */
const window_machine = machine<{
	idle: {};
	recording: { id: string; token: LockToken; done: Promise<WindowCapture> };
	stopping: { id: string; token: LockToken; answer: Promise<WindowAnswer> };
}>()({
	name: 'profiler-window',
	initial: 'idle',
	steps: { idle: ['recording'], recording: ['stopping', 'idle'], stopping: ['idle'] },
	after: { recording: { ms: WINDOW_MAX_MS, to: 'idle' } }
});

/**
 * One background loop (the trap, the always-on sampler): waiting for its next window (the visit
 * owns the timer), taking one, or ended. `caught` is what it kept so far (the trap's slow requests;
 * the sampler keeps none). It ends `done` (the trap kept all it was asked to), `refused` (a window
 * failed: the inspector refused it), or `retired` (a newer profiler took the process over).
 */
const loop_machine = machine<{
	idle: {};
	scheduled: { caught: number };
	capturing: { caught: number };
	done: { caught: number };
	refused: { caught: number; error: string };
	retired: { caught: number };
}>()({
	name: 'profiler-background-loop',
	initial: 'idle',
	steps: {
		idle: ['scheduled', 'retired'],
		scheduled: ['scheduled', 'capturing', 'retired'],
		capturing: ['scheduled', 'done', 'refused', 'retired'],
		done: ['retired'],
		refused: ['retired'],
		retired: []
	}
});
type Loop = ReturnType<typeof loop_machine.create>;

const caught_of = (loop: Loop): number => {
	const s = loop.now;
	return s.kind === 'idle' ? 0 : s.caught;
};

/** The trap as the dashboard shows it: waiting for or taking a window, stopped by a refusal, or
 *  not running (done, or not armed yet). */
function trap_state(loop: Loop): TrapStatus['state'] {
	const kind = loop.now.kind;
	if (kind === 'scheduled' || kind === 'capturing') return 'armed';
	return kind === 'refused' ? 'stopped' : 'done';
}

/** The span recorders of the windows recording now, newest last. Spans go to the newest; a window
 *  that ends hands them back to the one before it, never to nothing while another still records
 *  (two profilers in one dev process). */
const span_windows = registry<SpanRecorder>();

/** The window's recorder takes the spans while `owner` (the window) is open; returns the hand-back,
 *  which the window's end also does. */
function own_spans(r: SpanRecorder, owner: Scope): () => void {
	const gone = span_windows.add(r, owner);
	set_span_recorder(r);
	return () => {
		gone();
		let newest: SpanRecorder | null = null;
		for (const w of span_windows) newest = w;
		set_span_recorder(newest);
	};
}
/** the heap's fill (of its limit) past which no timed render is made: one more could end the process */
const HEAP_STOP = 0.85;
/** …and past which the extra renders (what a render keeps, the growth check) are skipped */
const HEAP_EXTRAS = 0.7;
/** …and past which a profile does not start: the warm-up renders come before any check, and a
 *  render's own peak (not only what it keeps) needs the room */
const HEAP_START = 0.75;
/** the dev server's answer for an island (vite/dev-maps.ts `DevPageKeys`) */
type DevIslandKeys = {
	keys: string[] | 'all' | null;
	why: { file: string; line: number | null; why: string }[];
};

/** the main thread's work in a render: the code on the sampled stacks and the collector's pauses */
// static: a fixed list of frame categories
const MAIN_THREAD_CPU: ReadonlySet<string> = new Set([
	'app',
	'component',
	'dependency',
	'node',
	'svelte',
	'gc'
]);
/** app modules whose built lines are their source lines, near enough to match by text */
const SCRIPT_MODULE_EXTS = ['.ts', '.js', '.mts', '.mjs', '.cts', '.cjs'];
/** marks the profiler's keep-the-answers render (its value: the recording's token) */
const ANSWERS_HEADER = 'x-og-profiler-answers';
/** renders the keep-the-answers measure takes at most (their median is the figure) */
const ANSWER_RENDERS = 3;
// Recordings SERIALIZE PER WORKER — the V8 inspector CPU/heap sampler and the attribution
// AsyncLocalStorage are both process-global, so two at once on one process would cross-pollute each
// other's samples. There is deliberately NO in-memory server queue: on serverless a worker is recycled
// within ~30 s (memory wiped), so a parked waiter is unreliable — and unnecessary, because a retry
// lands on a different, free worker. When a worker is busy it returns 409 immediately and the CLIENT
// polls (RunView) until some worker says yes. That "queue" needs no shared storage, so it works the
// same on Amplify (isolated workers) and on a single long-lived server.
/** an inspector-unavailable recording error (edge runtimes) vs a real profiling failure */
const INSPECTOR_ERR = /inspector/;
const WIN_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const QUERY_SUFFIX_RE = /\?.*$/;
const SRC_RELATIVE_RE = /(?:^|[/\\])src[/\\](.*)$/;
const BACKSLASH_G = /\\/g;
const PATH_SEP_RE = /[/\\]/;
const TRAILING_SLASH_RE = /\/$/;
/** a WebAssembly script "file" as V8 names it: `/wasm/00034eea`, `wasm://wasm/…` */
const WASM_FRAME_RE = /^(?:wasm:\/\/|\/wasm\/)|[/\\]wasm\/[0-9a-f]+$/;
/** a resolved caller that lives in node_modules or Kit's runtime source: the framework, not the app */
// Kit's runtime as its sourcemap spells it (`runtime/server/…`, `runtime/telemetry/record_span.js`
// in newer Kit, which wraps every load)
const FRAMEWORK_SOURCE_RE =
	/[/\\]node_modules[/\\]|(?:^|[/\\])runtime[/\\](?:server|app|telemetry)[/\\]/;
const NODE_MODULES_RE = /[/\\]node_modules[/\\]/;
/** a Kit endpoint file in a resolved caller string (`+server.ts`, or its built `_server.ts.js`) */
const SERVER_ROUTE_FILE_RE = /[/\\](?:\+server\.[jt]s|_server\.[jt]s\.js):\d+/;
/** the file inside a resolved caller string: `name (file:line)` or `file:line` */
const CALLER_FILE_RE = /(?:\(|^)([^()]+):\d+\)?$/;
/** what the dev source peek may read */
const SOURCE_EXT_RE = /\.(?:svelte|ts|js|mjs|cjs|tsx|jsx|svx|md|json)$/;

// Serverless page-profile budget. On a managed host the whole `/page` request must return before the
// platform's gateway kills it, so we cap all profiling work (warm-up + CPU runs + coverage pass) and
// keep the rest of the budget for analysis + serialization + response.
//
// NONE of these platforms expose their function timeout as a runtime env var (checked Aug 2026:
// Vercel's full system-env list, Amplify, Netlify) — it's build-time / gateway config — so we DETECT
// the platform and use its binding timeout, and honour OGYGIA_PROFILER_BUDGET_MS when the author has
// raised or lowered maxDuration from the default.
const SERVERLESS_RESERVE_MS = 5_000; // analysis + report build + .ogp/json serialize + jitter
/** the app lines the pattern finder reads, and the ones the report keeps and shows */
const LEDGER_FOR_PATTERNS = 200;
const LEDGER_SHOWN = 40;
/** how long a page recording waits for its store write before answering (inside the reserve) */
const PERSIST_WAIT_MS = 3_000;
/** The whole-request wall budget (ms) before the platform's gateway kills a /page profile — Infinity
 *  on a real server (adapter-node, dev). An explicit OGYGIA_PROFILER_BUDGET_MS wins over detection. */
function detect_request_budget_ms(): number {
	const override = Number(process.env.OGYGIA_PROFILER_BUDGET_MS);
	if (Number.isFinite(override) && override > 0) return override;
	const env = process.env;
	// Vercel + Netlify BOTH run on Lambda (AWS_LAMBDA_FUNCTION_NAME set), so check them FIRST.
	if (env.VERCEL) return 300_000; // Vercel Functions: 300s default (fluid); Pro/Ent max 800s
	if (env.NETLIFY) return 10_000; // Netlify Functions: 10s synchronous default (max 26s)
	// AWS Amplify (WEB_COMPUTE SSR) → CloudFront 30s origin timeout; also the generic Lambda + API GW cap.
	if (env.AWS_LAMBDA_FUNCTION_NAME || env.LAMBDA_TASK_ROOT) return 30_000;
	return Infinity; // a real server — no gateway kill
}
/** Time allotted to the profiling work itself (warm-up + runs + coverage), keeping RESERVE for the
 *  rest of the request. Halves as a floor so a very small budget still spends most of itself working. */
function serverless_work_budget_ms(): number {
	const req = detect_request_budget_ms();
	if (!Number.isFinite(req)) return Infinity;
	return Math.max(req - SERVERLESS_RESERVE_MS, Math.floor(req * 0.5));
}

/** A profiler session's life: a login lasts a working day. */
const SESSION_MS = 12 * 60 * 60 * 1000;
/** The most logouts remembered at once (each until its session would have expired). */
const MAX_REVOKED = 4096;
/** A session id: `s1.<random id>.<expiry, ms>.<HMAC of the three>`. */
const SESSION_RE = /^s1\.([A-Za-z0-9_-]{24})\.(\d{13})\.([0-9a-f]{64})$/;
/** The beacon flag: `f1.<its session's id>.<that session's expiry>.<HMAC of the three>`. */
const FLAG_RE = /^f1\.([A-Za-z0-9_-]{24})\.(\d{13})\.([0-9a-f]{64})$/;

/**
 * Page mode renders the SAME page N times, so its outbound calls are the same handful repeated N
 * times — a waterfall of 5×3 identical bars is noise. Given each run's [start,end] window, keep only
 * ONE representative render's net + io (the run that captured the most calls — the fullest picture;
 * ties go to the later, warmer run) so the network view reads as "one request + its leaf calls". CPU
 * stays merged across all runs (more samples = steadier median); network is inherently per-render.
 */
function scope_net_to_one_run(
	cap: { net: NetCall[]; io_ops: IoOp[] },
	windows: Array<{ start: number; end: number }>
): { start: number; end: number } | null {
	if (windows.length <= 1) return windows[0] ?? null;
	const within = (t: number, w: { start: number; end: number }) => t >= w.start && t <= w.end;
	let best = windows[0];
	let best_n = -1;
	for (const w of windows) {
		const n = cap.net.reduce((s, c) => s + (within(c.start, w) ? 1 : 0), 0);
		if (n >= best_n) {
			best_n = n;
			best = w;
		}
	}
	cap.net = cap.net.filter((c) => within(c.start, best));
	cap.io_ops = cap.io_ops.filter((o) => within(o.start, best));
	return best;
}

/**
 * The profiler as a class — state lives in fields, not closures, matching the
 * `OgygiaHandle` house style. `profiler(options)` (below) constructs one and
 * returns its bound `handle`.
 */
class Profiler {
	readonly base: string;
	readonly sample_interval: number;
	readonly max_reports: number;
	readonly ring_size: number;
	readonly want_network: boolean;
	readonly want_heap: boolean;
	readonly dev: boolean;
	readonly want_server_timing: boolean;
	readonly secret: string;
	readonly ui_enabled: boolean;
	readonly #disabled: boolean;
	/** The secret meets the production floor (dev: always): only then does a key or session count. */
	readonly #secret_ok: boolean;
	/** Wrong keys per address (the login form and the key headers): a spent budget is refused
	 *  before any compare; a right key spends nothing. */
	readonly #key_fails = new RateLimiter({ max: 10, windowMs: 15 * 60_000 });
	/** Sessions ended by a logout before their expiry (session id → its expiry), at most
	 *  {@link MAX_REVOKED}; each is dropped once it would have expired anyway. */
	readonly #revoked = new Map<string, number>();
	#session_key: Promise<CryptoKey> | null = null;
	#flag_key: Promise<CryptoKey> | null = null;

	// ---- state ------------------------------------------------------------
	readonly #ring: RequestEntry[] = [];
	readonly #reports = new Map<string, StoredReport>();
	/** the browser's hydration timings, by island fingerprint (`/beacon`) — joined into reports at view time */
	readonly #beacons = new Map<string, BeaconAgg>();
	/** the browser's web vitals per page path (`/beacon`), the profiler user's own visits */
	readonly #vitals = new Map<string, { samples: VitalsSample[]; last: number }>();
	/** the app's own browser marks per page path, per name (`mark()` from ogygia/profiler/client) */
	readonly #marks = new Map<
		string,
		Map<string, { ms: number[]; errors: number; attr_keys: Set<string> }>
	>();
	/** the trap (catch the slow one) and the always-on sampler: their state */
	readonly #trap: ProfilerOptions['trap'] | null;
	readonly #client_cpu: boolean;
	/** the browser's CPU profile of hydration, per page path (the profiler user's latest visit) */
	readonly #client_cpus = new Map<
		string,
		{ analysis: Analysis; at: number; sample_ms: number; windows?: ClientWindows }
	>();
	/** per page, the slowest interaction's CPU (its wait and its handlers), the latest trace */
	readonly #interaction_cpus = new Map<string, InteractionCpu & { at: number }>();
	/** the beacon's visits per page (the browser's picture of a page load), a few kept each */
	readonly #visits = new Map<string, Visit[]>();
	/** THE SINK: rows an ephemeral host posts out before it dies (see sink.ts) */
	readonly #sink = new SinkBuffer();
	#sink_url: string | null = null;
	#sink_key: string | null = null;
	#sink_every = 10_000;
	/** The background work's owner (the sink's timer, the trap's and the sampler's, their windows):
	 *  closed when a newer profiler takes the process over (`#retire`). */
	readonly #background: Scope = scope();
	/** The sink's timer, while it runs: its cancel. */
	#sink_timer: (() => void) | null = null;
	/** The sink's posts, one at a time in the order their rows were read: a failed one is tried
	 *  again before the next goes, so rows reach the sink in order and only once (#293). */
	readonly #sink_posts: Outbox<SinkPost> = outbox<SinkPost>({
		name: 'profiler sink',
		send: (post, signal) => this.#sink_post(post, signal),
		id: (post) => post.id,
		retry: SINK_POLICY,
		inOrder: true,
		giveUp: (post, error) => {
			// (kept for the site view, as every post's outcome is; the rows themselves are gone)
			// wall: shown as a time
			this.#sink_last = { at: Date.now(), ok: false, rows: post.rows, error: error_text(error) };
			warn('devtools_profiler_sink_undelivered', { rows: String(post.rows) }, error);
		},
		waitUntil: (work) => devtools_app()?.keepAlive(work)
	});
	#sink_last: { at: number; ok: boolean; rows: number; error?: string } | null = null;
	/** the trap's loop (see `loop_machine`) */
	readonly #trap_loop: Loop = loop_machine.create();
	readonly #sample: ProfilerOptions['sample'] | null;
	readonly #sampled: SampledWindow[] = [];
	/** the always-on sampler's loop */
	readonly #sample_loop: Loop = loop_machine.create();
	/** why the background loops are off on this host (serverless), when they are */
	#background_note: string | null = null;
	/** bytes per asset URL, measured once per process */
	readonly #weights = url_weights();
	/** every page asset weighed so far (hashed assets never change): page-assets.ts */
	readonly #asset_weights = new Map<string, Weight | null>();
	readonly #background_net: NetCall[] = [];
	/** each capture's own network log while it records (two only after a reset left one running) */
	readonly #window_nets = new Set<NetCall[]>();
	#inflight = 0;
	/** performance.now() when this instance's first request arrived (its cold start, on Lambda) */
	#first_request_pt: number | undefined;
	/** requests this instance has handled */
	#requests_seen = 0;
	// The recorder lock: held for the life of a recording (the inspector session is only free once it
	// ends). Non-blocking: a second recording on the same worker is refused, not queued (the client
	// retries onto another worker). See #take. Only its owner's token frees it: a recording that a
	// reset took it from frees, and switches off, nothing of the next one's.
	readonly #recorder = lock();
	/** what the owner records, and since when (see `recorder_machine`) */
	readonly #holder = recorder_machine.create();
	/** the window you start and stop (see `window_machine`) */
	readonly #win = window_machine.create();
	/** page profiles waiting for a background window to give the recorder back */
	#page_waiting = 0;
	/** the durable report store (SQLite/Redis/Postgres/custom), when configured — else null and the
	 *  in-memory map is all there is (the prior behaviour) */
	#store: import('./storage/index.ts').ProfilerStore | null = null;
	/** the store's `init`: kept once it succeeds, tried again by the next use after a failure */
	#store_init: Flights<void, void> | null = null;
	#als: import('node:async_hooks').AsyncLocalStorage<Ctx> | null = null;
	/** Re-assert the `globalThis.fetch` patch before a profile (self-heal if it was replaced). */
	#ensure_net: (() => void) | null = null;
	/** wraps Kit's `event.fetch` (in-process same-origin dispatch) with the recorder, per attributed request */
	#wrap_event_fetch: (<F extends typeof globalThis.fetch>(f: F) => F) | null = null;
	/** the network layer's kept answers (net.ts): what the keep-the-answers render is served */
	#kept: {
		/** each recording turns its own keeping on and off (`owner`) */
		keep: (owner: object, on: boolean) => void;
		get: (key: string) => Response | undefined;
		drop: (owner: object) => void;
		diff: (key: string) => { bytes: number; size: number; text: string } | undefined;
	} | null = null;
	/** the keep-the-answers render in flight: its request carries this token, and only these calls
	 *  (`GET <url>`, the same answer in every timed render) are served from memory */
	#answers: { token: string; keys: ReadonlySet<string> } | null = null;

	constructor(options: ProfilerOptions = {}) {
		this.base = options.path ?? '/__profiler';
		this.sample_interval = clamp(options.sampleInterval ?? 500, 50, 10_000);
		this.max_reports = options.maxReports ?? 6;
		this.ring_size = options.recentRequests ?? 500;
		this.want_network = options.network !== false;
		this.want_heap = options.heap !== false;
		this.dev = detect_dev(); // replaced by Vite when the app is built; falls back to NODE_ENV
		// Server-Timing exposes internal render/network timings to every client, so
		// default it ON in dev but OFF in production unless explicitly enabled.
		this.want_server_timing = options.serverTiming ?? this.dev;
		this.secret = options.secret ?? process.env.OGYGIA_PROFILER_SECRET ?? '';
		// (production: a secret under the floor opens nothing; test/profiler-login-guard.test.ts)
		const bytes = Buffer.byteLength(this.secret, 'utf8');
		this.#secret_ok = this.dev || bytes >= MIN_SECRET_BYTES;
		if (!this.#secret_ok && bytes > 0 && options.enabled !== false)
			console.error(new OgygiaError('devtools_profiler_secret_short', { bytes }));
		this.ui_enabled =
			options.enabled !== false && (this.dev || (this.secret !== '' && this.#secret_ok));
		this.#disabled = options.enabled === false;
		this.#trap = options.trap && options.trap.over > 0 ? options.trap : null;
		if (options.store) {
			const store = options.store;
			this.#store = store;
			// init may be sync-throwing (a driver, a bad path) or async-rejecting: both are a failed
			// flight, which is not kept, so the next use of the store tries it again (#289). It starts
			// at the mount, as before.
			this.#store_init = flights({
				name: 'profiler store init',
				run: async () => {
					await store.init?.();
				}
			});
			void this.#store_ready(); // ok: never rejects (a failed init is said: devtools_profiler_store_init_failed)
		}
		this.#client_cpu = options.clientCpu !== false;
		if (options.sink?.url) {
			this.#sink_url = options.sink.url;
			this.#sink_key = options.sink.key ?? this.secret ?? null;
			this.#sink_every = Math.max(1000, options.sink.every ?? 10_000);
			// a long-lived host flushes on a timer; a serverless one flushes after each request (below)
			if (!Number.isFinite(serverless_work_budget_ms())) {
				this.#sink_timer = this.#background.every(() => void this.#sink_flush(), this.#sink_every); // ok: a flush never rejects (its failure is kept for the site view)
			}
		}
		this.#sample = options.sample ? options.sample : null;
		// THE PROCESS'S LIVE PROFILER is the newest: the dev server re-runs the app's hooks on an edit
		// and `ogygia.handle()` builds a new one, while this one's background timers would go on
		// recording — sampling the process twice, and windows of two recorder locks overlapping
		// (request-stats' detail is counted for that). An older one's timers stand down at their next tick.
		(globalThis as Record<symbol, unknown>)[LIVE_PROFILER] = this;
		if (!this.#disabled) {
			// a live profiler is what the handle's stats are for, with the plugin or without it (#805)
			install_request_stats();
			// the holes a batch request renders land after the request is logged: each joins the log as it lands
			set_batch_hole_listener((request, s) => this.#batch_hole(request, s));
		}
	}

	/** Logged requests by their Request (a batch's holes find their request here), and the holes that
	 *  settled before their request was logged. */
	readonly #logged = new WeakMap<Request, RequestEntry>();
	readonly #early_holes = new WeakMap<Request, BatchHoleStats[]>();

	/** ONE HOLE OF A BATCH, logged as its own hole request — the shape every hole reading here knows
	 *  (the cache table, the render slots, a visit's holes): its own time within the batch, no CPU of
	 *  its own (the batch request carries that). */
	#batch_hole(request: Request, s: BatchHoleStats): void {
		const base = this.#logged.get(request);
		if (!base) {
			const early = this.#early_holes.get(request);
			if (early) early.push(s);
			else this.#early_holes.set(request, [s]);
			return;
		}
		const { ms, status, ...hole } = s;
		this.#ring.push({ ...base, ms: round2(ms), cpu_ms: 0, status, hole, og: undefined });
		if (this.#ring.length > this.ring_size) this.#ring.shift();
	}

	/** A newer profiler took this process over (a dev server that re-ran the app's hooks). */
	#superseded(): boolean {
		return (globalThis as Record<symbol, unknown>)[LIVE_PROFILER] !== this;
	}

	/** Stand down: the background timers stop (a sink sends what it holds first). */
	#retire(): void {
		const sinking = this.#sink_timer !== null;
		this.#sink_timer = null;
		for (const loop of [this.#trap_loop, this.#sample_loop])
			if (loop.now.kind !== 'retired') loop.go('retired', { caught: caught_of(loop) });
		this.#background.close();
		if (sinking) void this.#sink_flush(); // ok: a flush never rejects (its failure is kept for the site view)
	}

	/** A background window's length: `ms`, or less when the profiler stands down meanwhile. */
	#pause(ms: number): Promise<void> {
		return new Promise<void>((done) => {
			const wait = this.#background.child();
			wait.defer(done);
			wait.timeout(() => wait.close(), ms);
		});
	}

	// ---- background: the trap and the always-on sampler ----------------------
	/** Arm the background recorders (once, from the first request). Both need a real server: on a
	 *  serverless host an instance lives for one request and the inspector is often unavailable. */
	#arm_background(): void {
		if (!this.#trap && !this.#sample) return;
		if (Number.isFinite(serverless_work_budget_ms())) {
			this.#background_note =
				'trap / sampling are off on this serverless host (an instance lives for one request).';
			return;
		}
		if (this.#trap && this.#trap_loop.now.kind === 'idle')
			this.#schedule(this.#trap_loop, () => this.#trap_cycle(), 1000);
		if (this.#sample && this.#sample_loop.now.kind === 'idle')
			this.#schedule(
				this.#sample_loop,
				() => this.#sample_cycle(),
				(this.#sample.every ?? 60) * 1000
			);
	}

	/** The loop's next window, `delay_ms` from now: a timer of that wait's own visit. */
	#schedule(loop: Loop, cycle: () => Promise<void>, delay_ms: number): void {
		const s = loop.now;
		if (s.kind !== 'idle' && s.kind !== 'scheduled' && s.kind !== 'capturing') return;
		loop.go('scheduled', { caught: caught_of(loop) });
		loop.scope.timeout(() => void cycle(), delay_ms); // ok: a cycle catches its own failure
	}

	/** A window failed: the loop stops, and says why (on the dashboard, and once as a message). */
	#refused(loop: Loop, name: string, caught: number, error: unknown): void {
		if (!loop.move('capturing', 'refused', { caught, error: error_text(error) })) return;
		warn('devtools_profiler_background_stopped', { loop: name }, error);
	}

	/** The background loops that stopped, and why the loops are off, when they are: one note. */
	#background_notes(): string | null {
		const notes: string[] = [];
		if (this.#background_note !== null) notes.push(this.#background_note);
		const t = this.#trap_loop.now;
		if (t.kind === 'refused') notes.push(`the trap stopped: ${t.error}.`);
		const s = this.#sample_loop.now;
		if (s.kind === 'refused') notes.push(`always-on sampling stopped: ${s.error}.`);
		return notes.length === 0 ? null : notes.join(' ');
	}

	/** One rolling trap window: sample coarsely, then keep the window only if a request in it blew
	 *  past the threshold. The slowest such request is the report's request; the timeline is its. */
	async #trap_cycle(): Promise<void> {
		const t = this.#trap!;
		const loop = this.#trap_loop;
		const s = loop.now;
		if (s.kind !== 'scheduled') return;
		if (this.#superseded()) return this.#retire();
		const keep = t.keep ?? 3;
		const again = (ms: number) => this.#schedule(loop, () => this.#trap_cycle(), ms);
		// a page profile is waiting for the recorder: let it have it, come back after
		if (this.#page_waiting) return again(1000);
		const token = this.#take('background');
		if (token === null) return again(2000); // a recording is on — later
		loop.go('capturing', { caught: s.caught });
		let caught = s.caught;
		try {
			const window_ms = t.window ?? 5000;
			const cap = await this.#capture_window(
				(t.interval ?? 10) * 1000,
				() => this.#pause(window_ms),
				{ light: true }
			);
			const slow = this.#ring
				.filter(
					(e) =>
						!e.internal &&
						e.pt !== undefined &&
						e.ts >= cap.t0 &&
						e.ts + e.ms <= cap.t1 &&
						e.ms >= t.over
				)
				.sort((x, y) => y.ms - x.ms)[0];
			if (slow) {
				cap.window = { start: slow.pt!, end: slow.pt! + slow.ms };
				const id = await this.#finish_report(cap, {
					trigger: 'trap',
					request: { method: slow.method, path: slow.path, route: slow.route, ms: slow.ms },
					trap_over: t.over
				});
				const stored = this.#reports.get(id);
				if (stored)
					stored.replay = {
						path: slow.path + (slow.search ?? ''),
						headers: slow.replay_headers ?? {}
					};
				// a catch on an ephemeral host is worth nothing in memory: the sink gets its dump
				if (stored && this.#sink_url) {
					this.#sink.push({
						k: 'trap',
						t: stored.meta.created,
						path: slow.path,
						ms: slow.ms,
						id,
						dump: report_dump(stored.analysis, stored.meta, this.#report_extras(stored))
					});
					void this.#sink_flush(); // ok: a flush never rejects (its failure is kept for the site view)
				}
				caught++;
			}
		} catch (error) {
			// the inspector refused (another debugger, an unsupported host): stop trying
			return this.#refused(loop, 'trap', caught, error);
		} finally {
			this.#free(token);
		}
		if (caught >= keep) loop.move('capturing', 'done', { caught });
		else again(1000);
	}

	/** One always-on sample: a short coarse window folded into the rolling hot-functions table. */
	async #sample_cycle(): Promise<void> {
		const s = this.#sample!;
		const loop = this.#sample_loop;
		if (loop.now.kind !== 'scheduled') return;
		if (this.#superseded()) return this.#retire();
		const every_ms = (s.every ?? 60) * 1000;
		const again = (ms: number) => this.#schedule(loop, () => this.#sample_cycle(), ms);
		if (this.#page_waiting) return again(Math.min(every_ms, 2000));
		// (a background window too: no per-request context)
		const token = this.#take('background');
		if (token === null) return again(Math.min(every_ms, 5000));
		loop.go('capturing', { caught: 0 });
		try {
			const window_ms = s.window ?? 2000;
			const cap = await this.#capture_window(
				(s.interval ?? 10) * 1000,
				() => this.#pause(window_ms),
				{ light: true }
			);
			const resolver = await this.#make_resolver();
			const a = analyze(cap.profile, resolver, undefined, undefined, undefined, this.#module_hint);
			this.#sampled.push({
				at: cap.t0,
				ms: cap.duration_ms,
				busy_ms: a.busy_ms,
				functions: a.functions.slice(0, SAMPLED_FUNCTIONS_PER_WINDOW).map((f) => ({
					key: f.key,
					name: f.name,
					url: f.url,
					line: f.line,
					category: f.category,
					pkg: f.pkg,
					self_ms: f.self_ms
				}))
			});
			while (this.#sampled.length > MAX_SAMPLED_WINDOWS) this.#sampled.shift();
			if (this.#sink_url) {
				const w = this.#sampled[this.#sampled.length - 1];
				this.#sink.push({
					k: 'win',
					t0: w.at,
					t1: w.at + w.ms,
					fns: w.functions
						.slice(0, 40)
						.map((f) => ({ name: f.name, file: f.url, self_ms: f.self_ms, category: f.category }))
				});
			}
		} catch (error) {
			// unsupported host: stop
			return this.#refused(loop, 'always-on sampler', 0, error);
		} finally {
			this.#free(token);
		}
		again(every_ms);
	}

	/** The always-on table: every kept window folded, hot functions by summed self time. */
	#sampled_summary(): SampledSummary | null {
		if (!this.#sample) return null;
		const by_key = new Map<string, SampledSummary['functions'][number]>();
		let sampled_ms = 0;
		let busy_ms = 0;
		for (const w of this.#sampled) {
			sampled_ms += w.ms;
			busy_ms += w.busy_ms;
			for (const f of w.functions) {
				const g = by_key.get(f.key);
				if (g) {
					g.self_ms = round2(g.self_ms + f.self_ms);
					g.windows++;
				} else by_key.set(f.key, { ...f, windows: 1 });
			}
		}
		return {
			every_s: this.#sample.every ?? 60,
			window_ms: this.#sample.window ?? 2000,
			windows: this.#sampled.length,
			since: this.#sampled[0]?.at ?? null,
			sampled_ms: round2(sampled_ms),
			busy_ms: round2(busy_ms),
			functions: [...by_key.values()].sort((x, y) => y.self_ms - x.self_ms).slice(0, 40)
		};
	}

	#collect_window(call: NetCall): void {
		for (const net of this.#window_nets) if (net.length < MAX_WINDOW_NET) net.push(call);
	}

	/** An attributed request's context: its own calls (capped), each also offered to the window. */
	#request_ctx(entry: RequestEntry, owner: Scope): Ctx {
		const collect_window = (call: NetCall) => this.#collect_window(call);
		return {
			entry,
			net: [],
			spans: [],
			route: entry.route,
			path: entry.path,
			owner,
			on_net(call) {
				if (this.net.length < MAX_NET_PER_REQUEST) this.net.push(call);
				collect_window(call);
			}
		};
	}

	#init(): Promise<unknown> {
		return this.#init_done.get();
	}

	/** The mount's one-time setup: the background timers and the network capture (it never fails). */
	readonly #init_done = flights({
		name: 'profiler init',
		run: async () => {
			this.#arm_background();
			// AsyncLocalStorage + the fetch/http patch exist ONLY to attribute
			// outbound calls. With network capture off there is no per-request work
			// beyond wall timing — the honest "near-zero when off" path.
			if (!this.want_network) return;
			try {
				const { AsyncLocalStorage } = await import('node:async_hooks');
				this.#als = new AsyncLocalStorage<Ctx>();
			} catch {
				this.#als = null;
			}
			if (this.#als) {
				try {
					const {
						install_net_capture,
						ensure_fetch_patched,
						wrap_event_fetch,
						keep_answers,
						kept_answer,
						drop_answers,
						answer_diff
					} = await import('./net.ts');
					this.#wrap_event_fetch = wrap_event_fetch;
					this.#kept = {
						keep: keep_answers,
						get: kept_answer,
						drop: drop_answers,
						diff: answer_diff
					};
					await install_net_capture(this.#als, (call) => {
						this.#collect_window(call);
						this.#background_net.push(call);
						if (this.#background_net.length > MAX_BACKGROUND_NET) this.#background_net.shift();
					});
					// Kept so every profile can re-assert the patch — `globalThis.fetch` may have been
					// replaced since install (late undici init / a polyfill / HMR), which silently drops
					// capture. This is what makes a run RELIABLY see network instead of sometimes.
					this.#ensure_net = ensure_fetch_patched;
				} catch {
					// ok: a platform without patchable modules; wall timing still works
				}
			}
		}
	});

	// ---- recording --------------------------------------------------------
	/** A recording is "active" only if one started recently — a run abandoned by a frozen/killed
	 *  serverless invocation ages out after the cap instead of wedging the profiler forever. */
	#recording_active(): boolean {
		// (by its start too: a process frozen mid-profile and thawed may answer before its timer runs)
		const s = this.#holder.now;
		// wall: a frozen process's monotonic clock does not advance, and the freeze is what this catches
		return s.kind === 'recording' && Date.now() - s.since < RECORDING_MAX_MS;
	}

	/** Take the recorder without waiting: its token if it was free (now ours), null if busy. Recordings
	 *  serialize PER WORKER — one V8 inspector CPU/heap sampler + one attribution context per process — so
	 *  a second recording on the same process is refused, NOT queued in memory: on serverless the process
	 *  can be recycled at any moment (Amplify freezes a worker after ~30 s), so a waiter parked in memory
	 *  is unreliable, and it isn't needed — a retry lands on a different, free worker. The "queue" is the
	 *  CLIENT polling `/page` until a worker says yes (see RunView). A recording that runs past the hard
	 *  cap is cut (its own time, `recorder_machine`): the site stops paying for its context. */
	#take(kind: 'background' | 'recording'): LockToken | null {
		const token = this.#recorder.take();
		if (token === null) return null;
		this.#holder.go(kind, { token, since: Date.now() }); // wall: read across a freeze (above)
		// (leaving it, to `cut` or `free`, detaches the attribution context)
		this.#holder.scope.defer(() => this.#release_als());
		return token;
	}

	/**
	 * The answer to a recording asked for while the recorder is someone else's: a 409 the client
	 * retries, which says who holds it, since when, and whether that holder is STALE: a page recording
	 * past its cap (`cut`, or past RECORDING_MAX_MS by its start), whose request died before its
	 * cleanup ran. Only a stale holder is a reset's to take: a live one (a window someone started, a
	 * page profile still running, the trap) is someone's recording (#290).
	 */
	#busy(message: string): Response {
		const s = this.#holder.now;
		const holder =
			s.kind === 'free'
				? null
				: {
						kind: this.#win.now.kind !== 'idle' ? 'window' : s.kind,
						age_ms: Date.now() - s.since, // wall: `since` is a wall time (a freeze counts)
						stale: s.kind === 'cut' || (s.kind === 'recording' && !this.#recording_active())
					};
		return new Response(JSON.stringify({ busy: true, message, holder }), {
			status: 409,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'retry-after': '2',
				'cache-control': 'no-store'
			}
		});
	}

	/** `token` still owns the recorder (a reset, or the next owner, took it otherwise). */
	#holds(token: LockToken): boolean {
		const s = this.#holder.now;
		return s.kind !== 'free' && s.token === token;
	}

	/** Free the recorder, only for the token that owns it: false for one a reset took it from. Called
	 *  only when the recording is truly finished (its inspector session closed). */
	#free(token: LockToken): boolean {
		if (!this.#recorder.free(token)) return false;
		this.#holder.go('free');
		return true;
	}

	/** Production: detach the profiler's AsyncLocalStorage once a recording ends. An ALS that has
	 *  run once stays enabled — every async hop in the process keeps paying a store copy for it — until
	 *  `disable()`; the next `run()` re-enables it. Dev keeps it on (attribution is always on there). */
	#release_als(): void {
		if (!this.dev) this.#als?.disable();
	}

	async #capture_window(
		interval_us: number,
		work: () => Promise<void>,
		/** `light`: a background window — no stack capture per call, no heap sampling, no async-hooks
		 *  I/O tracking; the sampler and the net log only (what the trap / sampler can afford).
		 *  `gc_attr: false`: heap sampling as before (live objects only, one read at the end) —
		 *  no allocation-stream flags, no slices — the cheaper recording when GC attribution is
		 *  not wanted, and the control when measuring what the attribution itself costs. */
		opts: { light?: boolean; gc_attr?: boolean } = {}
	): Promise<WindowCapture> {
		const { Session } = await import('node:inspector/promises');
		const perf_hooks = await import('node:perf_hooks');
		// the build's embedded module map, before the window: the network capture tells a bundled
		// package's caller frame from the app's while the calls happen (loaded once; a recording only,
		// so an ordinary request never pays for parsing it)
		await load_embedded_maps();

		const session = new Session();
		session.connect();
		const histogram = perf_hooks.monitorEventLoopDelay({ resolution: 10 });
		histogram.enable();
		const elu0 = perf_hooks.performance.eventLoopUtilization();
		const cpu0 = process.cpuUsage();

		// PerformanceObserver complements the sampler: precise GC pause durations
		// (the sampler only estimates GC), and any performance.measure() spans the
		// app or its libraries already emit (DB drivers, OpenTelemetry, SvelteKit's
		// experimental tracing) — collected for free, shown only when present.
		const gc_pauses: number[] = [];
		// each pause with WHEN (performance.now clock), what kind, and the flags — joined later to
		// the allocations that filled the heap before it (gc.ts)
		const gc_raw: { start: number; ms: number; kind: number; flags: number }[] = [];
		const measures: { name: string; ms: number }[] = [];
		const ingest = (
			entries: ReadonlyArray<{
				entryType: string;
				name: string;
				duration: number;
				startTime?: number;
				detail?: unknown;
			}>
		) => {
			for (const e of entries) {
				if (e.entryType === 'gc') {
					gc_pauses.push(e.duration);
					const d = (e.detail ?? {}) as { kind?: number; flags?: number };
					if (gc_raw.length < 5000)
						gc_raw.push({
							start: e.startTime ?? 0,
							ms: e.duration,
							kind: d.kind ?? 0,
							flags: d.flags ?? 0
						});
				} else if (e.entryType === 'measure' && measures.length < 5000) {
					measures.push({ name: e.name, ms: e.duration });
				}
			}
		};
		let observer: import('node:perf_hooks').PerformanceObserver | undefined;
		try {
			observer = new perf_hooks.PerformanceObserver((list) => ingest(list.getEntries()));
			observer.observe({ entryTypes: ['gc', 'measure'] });
		} catch {
			// ok: entry types unavailable on this runtime; the sampler still covers GC
		}

		const mem: MemSample[] = [];
		// (the window's t0 and t1 are matched against the request ring's epoch `ts`, and become the
		// report's `created`)
		const t0 = Date.now(); // wall: see above
		const sample_mem = () => {
			const m = process.memoryUsage();
			mem.push({
				t: Date.now() - t0, // wall: on the window's own t0 (above)
				rss: Math.round(m.rss / 1048576),
				heap_used: Math.round(m.heapUsed / 1048576)
			});
		};
		sample_mem();
		// the window's own sampling timers, stopped as it ends
		const sampling = scope();
		sampling.every(sample_mem, 250);
		// ALLOCATION ON THE TIMELINE: the used heap read finely (a V8 statistic, no syscall, a few
		// µs) so the report can say WHEN the heap grew and what ran then (alloc.ts). A timer only
		// fires when the loop yields, so each interval is "between two awaits" — the samples
		// carry their true times, the analysis never assumes the period. Full windows only.
		const heap_series: { t: number; mb: number }[] = [];
		if (!opts.light) {
			try {
				const v8 = await import('node:v8');
				const sample_heap = () => {
					if (heap_series.length >= HEAP_SERIES_MAX) return;
					heap_series.push({
						t: perf_hooks.performance.now(),
						mb: v8.getHeapStatistics().used_heap_size / 1048576
					});
				};
				sampling.every(sample_heap, HEAP_SERIES_PERIOD_MS);
			} catch {
				// ok: no v8 module (edge): no heap series
			}
		}

		// this capture's own: its network log, and its asks for stacks and spans (another capture
		// ending, in this profiler after a reset or in another one, never takes them away)
		// (each turned on right at the `try` whose `finally` turns it off)
		const owner = {};
		const window_net: NetCall[] = [];
		const netmod = await import('./net.ts').catch(() => null); // ok: a runtime with no network module: no network capture, the window still records
		// SPANS (`span()` / `tag()` from ogygia/profiler): recorded only while this window runs.
		// A span rides the same async context as the fetch patch — the request it belongs to, and
		// for nesting a child store carrying the span's id (only during a recording, so the per-hop
		// cost of a second store never reaches an un-profiled request).
		// NESTING outside a request context: a span opened where no request is being attributed
		// (a handle in front of ogygia's, a background job) still needs its parent — a store of the
		// recording's own, alive only for this window
		const { AsyncLocalStorage: SpanALS } = await import('node:async_hooks');
		const span_als = new SpanALS<number>();
		const window_spans = new WindowSpans(this.#als, span_als, netmod);
		const { spans } = window_spans;
		const iomod = opts.light ? null : await import('./async-io.ts').catch(() => null); // ok: a runtime with no async hooks: no I/O lanes, the window still records
		let io_rec = iomod ? await iomod.IoRecorder.start() : null;

		let heap_head: HeapNode | null = null;
		// DETAIL from ogygia's handle (per-island rows, the seed explainer, hole notes) costs a little
		// per region — asked for only while this window records (server/request-stats.ts): this
		// window's own hold, taken right at the `try` whose `finally` lets go of it
		const release_detail = hold_request_stats_detail();
		this.#window_nets.add(window_net);
		// capture the calling stack of each outbound I/O call for the duration of
		// the window (off otherwise — it costs a stack per call)
		if (!opts.light) netmod?.set_stack_capture(owner, true);
		const disown_spans = own_spans(window_spans, sampling);
		try {
			await session.post('Profiler.enable');
			await session.post('Profiler.setSamplingInterval', { interval: interval_us });
			let heap_on = false;
			if (this.want_heap && !opts.light) {
				try {
					await session.post('HeapProfiler.enable');
					// objects already collected stay in the profile: the ALLOCATION stream (what drives the
					// collector), not just what is still alive when the profile is read
					if (opts.gc_attr !== false) {
						try {
							await session.post('HeapProfiler.startSampling', {
								samplingInterval: GC_SAMPLING_BYTES,
								...GC_SAMPLING_FLAGS
							});
							heap_on = true;
						} catch {
							// a sampler left running by an interrupted recording (one per isolate): stop it, once
							try {
								await session.post('HeapProfiler.stopSampling');
								await session.post('HeapProfiler.startSampling', {
									samplingInterval: GC_SAMPLING_BYTES,
									...GC_SAMPLING_FLAGS
								});
								heap_on = true;
							} catch (e) {
								if (process.env.OGYGIA_PROFILER_DEBUG)
									console.error(new OgygiaError('devtools_profiler_alloc_sampling_unavailable'), e);
								await session.post('HeapProfiler.startSampling', { samplingInterval: 16384 });
							}
						}
					} else await session.post('HeapProfiler.startSampling', { samplingInterval: 16384 });
				} catch {
					// ok: heap sampling unsupported here; the window records without it
				}
			}
			// The samples' clock: V8 stamps the profile's `startTime` when the profile is created, at
			// the START of this call — then scans every compiled function before the call returns
			// (tens of ms on a big heap). Taking the mark BEFORE the post keeps the samples on the
			// net/io clock; taken after, every CPU sample landed that scan-time late on the timeline.
			const perf_start = perf_hooks.performance.now();
			await session.post('Profiler.start');

			// THE ALLOCATION STREAM: one sampling session across the window, read ONCE at the end.
			// Not read during the work, deliberately: every read of the sampling profile (a stop or a
			// getSamplingProfile) set off a major collection, and a dozen reads made the collector
			// being measured three times slower — the attribution would have reported the pauses it
			// caused. Who allocated comes from the one read; WHEN each pause fell and what was running
			// then comes from the pause events and the CPU profile (gc.ts joins them).
			const gc_slices: AllocSlice[] = [];
			const gc_dict: Record<string, AllocSite> = {};

			await work();
			// the work is done: a GC pause after this point is the recorder's own, not the app's
			const perf_end = perf_hooks.performance.now();

			const { profile } = await session.post('Profiler.stop');
			// its script names, for the heap samples that leave them out (the dev server's modules)
			learn_script_urls(profile as CpuProfile);
			// only the window that STARTED sampling stops it: the sampler is one per isolate, and a
			// background window (trap, sampler — no heap) ending here would kill a page recording's
			if (this.want_heap && !opts.light) {
				try {
					const res = await session.post('HeapProfiler.stopSampling');
					heap_head = (res as { profile?: { head?: HeapNode } }).profile?.head ?? null;
					if (heap_on && heap_head) {
						const cur = heap_sites(heap_head, gc_dict);
						const bytes: Record<string, number> = {};
						for (const [k, v] of cur) if (v > 0) bytes[k] = v;
						gc_slices.push({ t0: 0, t1: round2(perf_end - perf_start), bytes });
					}
				} catch {
					heap_head = null;
				}
			}
			const t1 = Date.now(); // wall: matched against the request ring's epoch `ts` (t0, above)
			sample_mem();
			// drain entries the observer buffered but hasn't delivered to its
			// callback yet (deferred batching would otherwise lose the last GCs)
			try {
				if (observer) ingest(observer.takeRecords());
			} catch {
				// ok: takeRecords unsupported; callback-delivered entries are still counted
			}

			const cpu = process.cpuUsage(cpu0);
			const elu = perf_hooks.performance.eventLoopUtilization(elu0);
			const duration_ms = t1 - t0;
			const net = window_net;

			// a span never ended before the window closed stays `open` (a hung driver call, a
			// handle the app forgot) — reported as such, never timed as if it had finished
			for (const s of spans) if (s.ms < 0) s.open = true;
			return {
				profile: profile as CpuProfile,
				heap: heap_head,
				mem,
				net,
				spans,
				gc_pauses,
				gc_events: gc_raw
					.filter((g) => g.start >= perf_start && g.start <= perf_end)
					.map((g) => ({
						t: round2(g.start - perf_start),
						ms: round2(g.ms),
						kind: gc_kind(g.kind),
						flags: g.flags
					})),
				gc_slices,
				gc_dict,
				...(io_rec ? { promises: io_rec.promises() } : {}),
				io_ops: io_rec ? io_rec.stop() : [],
				call_counts: {},
				measures: summarize_measures(measures),
				loop: {
					p50: round2(histogram.percentile(50) / 1e6),
					p99: round2(histogram.percentile(99) / 1e6),
					max: round2(histogram.max / 1e6)
				},
				cpu_percent:
					duration_ms > 0
						? round2(((cpu.user + cpu.system) / 1000 / duration_ms) * 100)
						: undefined,
				elu_percent: round2(elu.utilization * 100),
				t0,
				t1,
				duration_ms,
				perf_start,
				// the series on the capture's clock (ms from the profiler's start), inside the window only
				...(heap_series.length >= 3
					? {
							heap_series: heap_series
								.filter((h) => h.t >= perf_start && h.t <= perf_end)
								.map((h) => ({ t: round2(h.t - perf_start), mb: h.mb }))
						}
					: {})
			};
		} finally {
			sampling.close();
			histogram.disable();
			disown_spans();
			span_als.disable(); // the recording's own nesting store: gone with the window
			release_detail();
			netmod?.set_stack_capture(owner, false);
			io_rec?.stop();
			try {
				observer?.disconnect();
			} catch {
				// ok: already disconnected, which is what this was for
			}
			this.#window_nets.delete(window_net);
			try {
				session.disconnect();
			} catch {
				// ok: already disconnected, which is what this was for
			}
		}
	}

	/**
	 * Exact per-function call counts (the ×N), from V8 precise coverage. Run as
	 * its OWN render, not during the CPU sampling window — coverage disables
	 * inlining, so mixing it into the sampled profile makes tiny hot functions
	 * (svelte's `child`, `push`) look like the bottleneck. Counts are per this
	 * single render.
	 */
	/** Call counts from one render under precise coverage. That render runs with V8's inlining off,
	 *  so a CPU profile taken during it (`with_profile`) keeps every app function in its own frame:
	 *  the report reads it for WHO a merged line's time belongs to (`unsmear`), never for how long
	 *  anything takes (no inlining makes everything slower). Same render, no extra one. */
	async #count_calls(
		work: () => Promise<void>,
		with_profile = false
	): Promise<{ counts: Record<string, number>; profile?: CpuProfile }> {
		const counts: Record<string, number> = {};
		let profile: CpuProfile | undefined;
		try {
			const { Session } = await import('node:inspector/promises');
			const session = new Session();
			session.connect();
			try {
				await session.post('Profiler.enable');
				// (block counts — `detailed` — are NOT asked for: V8 only instruments functions compiled
				// after it is on, and a warm server's are compiled already)
				await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
				if (with_profile) {
					await session.post('Profiler.setSamplingInterval', { interval: 200 });
					await session.post('Profiler.start');
				}
				try {
					await work();
				} finally {
					if (with_profile) {
						try {
							profile = ((await session.post('Profiler.stop')) as { profile: CpuProfile }).profile;
						} catch {
							profile = undefined;
						}
					}
				}
				const cov = (await session.post('Profiler.takePreciseCoverage')) as {
					result: Array<{
						url: string;
						scriptId?: string;
						functions: Array<{ functionName: string; ranges: Array<{ count: number }> }>;
					}>;
				};
				await session.post('Profiler.stopPreciseCoverage');
				// Key by name AND script url: many scripts have a `traverse`/`update`/etc., and merging them
				// by bare name gave every same-named frame the SUMMED total. `<name>\0<url>` is the same
				// identity analyze() joins on (a CPU frame's raw functionName + url), so each function keeps
				// its own count. Anonymous (`(anonymous)`, empty) frames are skipped — components attach via
				// their named wrapper.
				for (const script of cov.result) {
					for (const fn of script.functions) {
						const nm = fn.functionName;
						if (!nm || nm.startsWith('(')) continue;
						const c = fn.ranges[0]?.count ?? 0;
						if (c > 0) {
							const k = `${nm}\0${script.url}`;
							counts[k] = (counts[k] ?? 0) + c;
							// ...and by its script id, which the CPU profile's frames carry too: a script
							// made from a string (the dev server's modules) is `/app/x.ts` here and
							// `file:///app/x.ts` there
							if (script.scriptId) {
								const ki = `${nm}\0#${script.scriptId}`;
								counts[ki] = (counts[ki] ?? 0) + c;
							}
						}
					}
				}
			} finally {
				session.disconnect();
			}
		} catch {
			// ok: no inspector or coverage here; the call counts are left out
		}
		return { counts, ...(profile ? { profile } : {}) };
	}

	/** URL → local client file, for the browser CPU profile (see client-files.ts); undefined off Node */
	async #client_file_finder(
		origin: string | undefined
	): Promise<((url: string) => string | undefined) | undefined> {
		try {
			const fs = await import('node:fs');
			const path = await import('node:path');
			const entry = process.argv[1] ? path.dirname(process.argv[1]) : undefined;
			const dirs = client_dir_candidates(entry, process.cwd(), path.join);
			return client_file_finder(origin, dirs, (p) => fs.existsSync(p), path.join);
		} catch {
			return undefined;
		}
	}

	/** THE MODULE MAP's word on a bundled server frame (no sourcemap needed): the profiler's own code,
	 *  ogygia's runtime or a bundled package, else nothing (the app's) — `analyze`'s `url_category` */
	#module_find = module_lookup();
	/** A BUILD WITHOUT SOURCEMAPS: a line of a built chunk named by the source module it came from
	 *  (the build's module map), so `chunks/format.js:131` reads as src/lib/format.ts */
	/** a position in a BUILT chunk that the module map files under the app (no sourcemap to resolve
	 *  it): the place to charge memory to, as the ledger names chunk lines. Undefined otherwise */
	#chunk_at(
		url: string | undefined,
		line: number | undefined
	): { path: string; line: number } | undefined {
		if (!url || !line || line <= 0) return undefined;
		let path = url;
		if (path.startsWith('file://'))
			try {
				path = decodeURIComponent(new URL(path).pathname);
			} catch {
				return undefined;
			}
		// (a relative name too: the map lookup resolves it — `./chunks/x.js` on Lambda)
		if (!may_be_chunk(path)) return undefined;
		const id = this.#module_find(path, line);
		return id && !module_category(id) ? { path, line } : undefined;
	}

	#label_module(x: { path: string; line: number; module?: string }): void {
		if (x.module || !may_be_chunk(x.path)) return;
		const id = this.#module_find(x.path, x.line);
		if (id && !module_category(id)) x.module = id;
	}
	#module_hint = (url: string, _name: string, line: number) => {
		const id = this.#module_find(url, line);
		return id ? module_category(id) : undefined;
	};

	async #make_resolver(): Promise<SourceMapResolver | undefined> {
		try {
			const fs = await import('node:fs');
			const path = await import('node:path');
			// Frame urls are not always absolute: a host that re-bundles the adapter output as CJS
			// (Lambda / Amplify) hands V8 script names RELATIVE to the bundle dir ('./chunks/x.js').
			// A bare readFileSync resolves those against the process CWD — usually NOT the bundle dir
			// on such hosts — so every map lookup missed and `where` stayed at bundled positions even
			// with .map files shipped. Try the entry script's dir (and its parent) before cwd; the
			// resolver caches per chunk, so the extra attempts cost once per file.
			const entry = process.argv[1] ? path.dirname(process.argv[1]) : undefined;
			const bases = entry ? [entry, path.dirname(entry), '.'] : ['.'];
			const is_abs = (p: string) => p.startsWith('/') || WIN_DRIVE_RE.test(p);
			// the maps the build wrote into the code: what a host that left the `.map` files behind
			// (an adapter that traces imports, one that re-bundles) still has (embedded-maps.ts)
			await load_embedded_maps();
			// the dev server: the transformed modules' maps from Vite's module graph (vite/dev-maps.ts)
			const dev_map = this.dev
				? ((globalThis as Record<symbol, unknown>)[Symbol.for('ogygia.profiler.dev-maps')] as
						| ((id: string) => string | undefined)
						| undefined)
				: undefined;
			// ...and the browser's modules, by the URL path the dev server served them at
			const dev_client_map = this.dev
				? ((globalThis as Record<symbol, unknown>)[
						Symbol.for('ogygia.profiler.dev-client-maps')
					] as ((url: string) => string | undefined) | undefined)
				: undefined;
			return sourcemap_resolver(
				(p) => {
					if (dev_map && p.endsWith('.map')) {
						const m = dev_map(p.slice(0, -4));
						if (m) return m;
					}
					if (dev_client_map && p.startsWith('/') && p.endsWith('.map')) {
						const m = dev_client_map(p.slice(0, -4));
						if (m) return m;
					}
					for (const base of is_abs(p) ? [''] : bases) {
						try {
							return fs.readFileSync(base ? path.join(base, p) : p, 'utf8');
						} catch {
							// ok: not under this base; the next is tried
						}
					}
					// a map the host left behind; a source file it did not ship (a build without maps
					// matches its chunks to the app's sources by text: the copies the build carried)
					return p.endsWith('.map')
						? embedded_map_of(p.slice(0, -4))
						: (embedded_source(p) ?? embedded_chunk(p));
				},
				// a chunk with no map: the app script module at that line (`src/lib/x.ts`), whose
				// lines are matched by text; a package's or the framework's module, by its path (Kit's
				// runtime in its own chunk is Kit's, not the app's). Not a component (its compiled
				// markup is not its source text: the chunk line stays), not generated code
				(chunk, line) => {
					const id = this.#module_find(chunk, line);
					if (!id || id.startsWith('\0') || id.startsWith('virtual:') || id.startsWith('ogygia:'))
						return undefined;
					if (id.startsWith('src/')) {
						if (!SCRIPT_MODULE_EXTS.some((e) => id.endsWith(e))) return undefined;
						return { source: path.resolve(process.cwd(), id), text: true };
					}
					return { source: path.resolve(process.cwd(), id), text: false };
				},
				// (in dev a `.ts` / `.svelte` module has a map too: its transformed code's)
				{ any_ext: !!dev_map }
			);
		} catch {
			return undefined;
		}
	}

	async #finish_report(
		cap: WindowCapture,
		meta_partial: Pick<
			ReportMeta,
			| 'trigger'
			| 'page'
			| 'runs'
			| 'runs_set_aside'
			| 'request'
			| 'redirected_from'
			| 'redirect_stub'
			| 'warmup_ms'
			| 'run_status'
			| 'run_bytes'
			| 'budget_note'
			| 'trap_over'
			| 'cold'
			| 'answers'
			| 'lambda'
			| 'lambda_mb'
			| 'heap_limit_mb'
			| 'instance'
		>,
		/** page mode on a built app: the app's own fetch, to weigh the islands' JS closures */
		fetch_url?: FetchUrl
	): Promise<string> {
		// THE PROFILER'S OWN REQUESTS are not the app's calls: its UI keeping the previous report
		// (`GET /__profiler/report/<id>.dump`) while this one records read as two failed app calls
		const own = `${this.base}/`;
		const path_of = (u: string) => {
			if (u.startsWith('/')) return u;
			try {
				return new URL(u).pathname;
			} catch {
				return u;
			}
		};
		cap.net = cap.net.filter((c) => !path_of(c.url).startsWith(own));
		const resolver = await this.#make_resolver();
		const heap = cap.heap ? analyze_heap(cap.heap) : null;
		const heap_components = cap.heap ? heap_by_component(cap.heap) : null;
		// resolve each I/O caller's bundled location back to source, using the same
		// sourcemap resolver the CPU frames use — turns `_page.server.ts.js:8` into
		// `routes/mixed/+page.server.ts:10`, and drops the bundler's chained names.
		// Keep the path relative to `src/` (not just the basename) — `+page.server.ts`
		// alone is ambiguous when many routes have one.
		const rel_src = (f: string) => {
			const clean = f.replace(QUERY_SUFFIX_RE, '');
			const m = SRC_RELATIVE_RE.exec(clean);
			if (m) return m[1].replace(BACKSLASH_G, '/');
			return clean.split(PATH_SEP_RE).slice(-3).join('/');
		};
		/** the source position a caller resolved to (absolute when the map gave one): what the
		 *  pattern finder reads the call site's code from */
		let last_at: { path: string; line: number } | undefined;
		const resolve_caller = (site?: CallerSite): string | undefined => {
			last_at = undefined;
			if (!site) return undefined;
			const name =
				site.fn && site.fn !== '(anonymous)' && !site.fn.includes('.') ? site.fn : undefined;
			let file = rel_src(site.file);
			let line = site.line;
			const m = resolver?.resolve(
				site.file,
				Math.max(0, site.line - 1),
				Math.max(0, site.column - 1)
			);
			if (m) {
				file = rel_src(m.source);
				line = m.line;
			}
			// a caller that maps back into the profiler is our own I/O (the mem
			// sampler's timer) — drop it, it is not the app's wait
			if (file.startsWith('profiler/') || file.includes('/profiler/')) return undefined;
			// a WebAssembly frame is a library's internals — undici's HTTP parser (llhttp) is the
			// usual one: the zlib stream inflating a gzip response, a socket timer — never the app's
			// own wait. Unattributed, like the runtime's own resources.
			if (WASM_FRAME_RE.test(file)) return undefined;
			// a frame the sourcemap sends back INTO the framework (Kit's `load_data.js` behind its
			// `event.fetch`, a bundled dependency) is not the app's caller either — the next frame
			// of the call chain is
			// (the FULL resolved path too: the short one drops `node_modules/` — Kit's
			// `exports/internal/event.js`, bundled into an adapter's own chunks, maps back there)
			// (only `node_modules/` there: an app folder named `runtime/server` is still the app's)
			if (FRAMEWORK_SOURCE_RE.test(file) || (m && NODE_MODULES_RE.test(m.source))) return undefined;
			last_at = { path: m ? m.source : site.file, line };
			return name ? `${name} (${file}:${line})` : `${file}:${line}`;
		};
		for (const c of cap.net) {
			const ats: { path: string; line: number }[] = [];
			const chain = (c.caller_chain ?? (c.caller_site ? [c.caller_site] : []))
				.map((site) => {
					const text = resolve_caller(site);
					if (text && last_at && ats.length < 2) ats.push(last_at);
					return text;
				})
				.filter((s): s is string => !!s);
			c.caller = chain[0] ?? c.caller;
			if (ats[0]) c.caller_at = ats[0];
			if (ats[1]) c.outer_at = ats[1];
			if (chain.length > 1) c.callers = chain;
			delete c.caller_site;
			delete c.caller_chain;
		}
		for (const o of cap.io_ops) {
			o.caller = resolve_caller(o.caller_site);
			if (o.caller && last_at) o.caller_at = last_at;
			delete o.caller_site;
		}
		for (const s of cap.spans) {
			s.caller = resolve_caller(s.caller_site);
			delete s.caller_site;
		}
		// who made the promises, on source lines: the sampled origins carry their generated position
		// (a built route chunk `_page.server.ts.js:16` is no line anyone can open). A dependency's
		// origin maps into the dependency, and says so; unmapped ones keep their generated text.
		if (cap.promises) {
			// a library's origin reads by its function (Svelte's renderer at three lines of one
			// function is one entry); the app's keeps its line, the one to open
			const merged = new Map<string, number>();
			for (const t of cap.promises.top) {
				const m = t.site
					? resolver?.resolve(
							t.site.file,
							Math.max(0, t.site.line - 1),
							Math.max(0, t.site.column - 1)
						)
					: undefined;
				const src = m?.source ?? t.site?.file ?? '';
				const nm = src.lastIndexOf('/node_modules/');
				const fn = m?.name ?? t.site?.fn ?? '';
				// a library by its package name (`svelte`, `@acme/ui`), the app by file and line
				const caller = !t.site
					? t.caller
					: nm !== -1
						? `${fn} (${pkg_of(src.slice(nm + 14))})`
						: m
							? `${fn} (${rel_src(m.source)}:${m.line})`
							: t.caller;
				merged.set(caller, (merged.get(caller) ?? 0) + t.share);
			}
			cap.promises = {
				count: cap.promises.count,
				top: [...merged]
					.sort((a, b) => b[1] - a[1])
					.map(([caller, share]) => ({ caller, share: Math.round(share * 100) / 100 }))
			};
		}
		// THE TIMELINE INPUT: the one request's window + every call it waited on (net + the I/O
		// primitives the hooks timed, minus the ones still open) — analyze puts the CPU samples on
		// the same clock and walks the critical path (timeline.ts).
		const requests = this.#ring.filter((e) => e.ts + e.ms >= cap.t0 && e.ts <= cap.t1);
		// the profiled request's route: another route's code sampled in the same window is another
		// visitor's request (analyze sets it aside) — the profiler's own renders of the page name it
		const page_path = meta_partial.page?.split('?')[0];
		const own_route =
			meta_partial.trigger === 'page'
				? requests.find((e) => e.internal && e.path === page_path && e.route)?.route
				: meta_partial.request?.route;
		const timeline_input = cap.window
			? {
					...this.#timeline_input(cap),
					...(own_route ? { route: own_route } : {})
				}
			: undefined;
		// the island host wrappers read as their island (`ProductCard (island host)`), not as the
		// hash Svelte named their virtual file with
		const analysis = analyze(
			cap.profile,
			resolver,
			cap.call_counts,
			timeline_input,
			island_host_renamer(requests),
			this.#module_hint
		);
		const id = Math.random().toString(36).slice(2, 10);
		const meta: ReportMeta = {
			id,
			created: cap.t0,
			duration_ms: round2(cap.duration_ms),
			sample_interval_us: this.sample_interval,
			requests,
			loop_delay: cap.loop,
			cpu_percent: cap.cpu_percent,
			elu_percent: cap.elu_percent,
			rss_mb: cap.mem.at(-1)?.rss,
			node: process.version,
			dev: this.dev || undefined,
			...meta_partial
		};
		// WHO CAUSED THE GC: the pauses joined to the allocation slices (a light window has neither)
		let gc_attr: GcAttribution | undefined;
		if (cap.gc_slices?.length && (cap.gc_events?.length || Object.keys(cap.gc_dict ?? {}).length)) {
			try {
				// source maps FIRST: the sites' files and lines back to the source, the app caller each
				// names too, and the category from the true file — so the profiler's own allocations
				// (its heap reads, its stack captures) read as the profiler's and are left out
				if (resolver && cap.gc_dict) {
					const short = (u: string) =>
						u
							.replace(/^file:\/\//, '')
							.split('/')
							.slice(-2)
							.join('/');
					for (const site of Object.values(cap.gc_dict)) {
						const m = site.url ? resolver.resolve(site.url, site.line - 1, 0) : undefined;
						if (m) {
							site.url = m.source;
							site.line = m.line;
							const c = categorize({
								functionName: site.name,
								url: m.source,
								lineNumber: m.line - 1,
								columnNumber: 0,
								scriptId: ''
							});
							if (site.category !== 'component' && c.category !== 'component')
								site.category = c.category;
						}
						let caller_at: { path: string; line: number } | undefined;
						if (site.caller_url && site.caller_name) {
							const c = resolver.resolve(site.caller_url, (site.caller_line ?? 1) - 1, 0);
							if (c) {
								site.caller = `${site.caller_name} (${short(c.source)}:${c.line})`;
								caller_at = { path: c.source, line: c.line };
								// a builtin called from the profiler's own code is the profiler's too
								if (
									site.category !== 'component' &&
									categorize({
										functionName: site.caller_name,
										url: c.source,
										lineNumber: 0,
										columnNumber: 0,
										scriptId: ''
									}).category === 'profiler'
								)
									site.category = 'profiler';
							}
						}
						// the app line to charge: the site itself when it is the app's code, else the
						// nearest app caller (a builtin's bytes belong to the line that called it)
						if ((site.category === 'app' || site.category === 'component') && m)
							site.at = { path: m.source, line: m.line };
						else if (caller_at) site.at = caller_at;
						// a build without sourcemaps: the site (or its caller) at its line of the built chunk
						else if (!m) {
							const own = this.#chunk_at(site.url, site.line);
							const at = own ?? this.#chunk_at(site.caller_url, site.caller_line);
							if (at) site.at = at;
						}
					}
				}
				const first = cap.mem[0]?.heap_used;
				const last = cap.mem[cap.mem.length - 1]?.heap_used;
				const window_offset_ms = cap.window ? round2(cap.window.start - cap.perf_start) : 0;
				gc_attr = attribute_gc({
					slices: cap.gc_slices,
					events: cap.gc_events ?? [],
					dict: cap.gc_dict ?? {},
					window_ms: cap.duration_ms,
					// what was RUNNING when each pause fell: the CPU segments over the whole capture
					// (every run), else the profiled window's, shifted onto the capture's clock
					...(analysis.capture_cpu
						? { running: analysis.capture_cpu }
						: analysis.timeline
							? {
									running: analysis.timeline.segments
										.filter((s) => s.kind === 'cpu')
										.map((s) => ({
											t0: s.t0 + window_offset_ms,
											t1: s.t1 + window_offset_ms,
											label: s.label,
											category: s.category,
											file: s.file
										}))
								}
							: {}),
					...(first !== undefined && last !== undefined ? { retained_mb: last - first } : {})
				});
				gc_attr.window_offset_ms = window_offset_ms;
			} catch (e) {
				if (process.env.OGYGIA_PROFILER_DEBUG)
					console.error(new OgygiaError('devtools_profiler_gc_attribution_failed'), e);
				gc_attr = undefined;
			}
		}
		// AS IF THE PROFILER WERE NOT THERE: its own CPU frames and its share of the GC pauses are
		// measured, reported once, and taken out of the runs; the GC summary is the normalised one
		{
			const cpu_over = analysis.overhead_ms;
			const gc_over = gc_attr?.summary.overhead_ms ?? 0;
			const n = meta.runs?.length ?? 0;
			// per run: the profiler's CPU inside that run's window, plus its share of the GC pauses
			// that fell inside it — NOT a flat split of the total, which would charge a run for the
			// profiler's start-up scan of compiled code (hundreds of ms on a big process, before the
			// first render) or its final reads (after the last)
			const per_run = Array.from({ length: n }, () => 0);
			const cpu_in_runs = analysis.overhead_by_run_ms ?? [];
			for (let i = 0; i < n; i++) per_run[i] += cpu_in_runs[i] ?? 0;
			if (gc_attr && cap.runs?.length) {
				for (const p of gc_attr.pauses) {
					const t_abs = cap.perf_start + p.t;
					const i = cap.runs.findIndex((r) => t_abs >= r.start && t_abs <= r.end);
					if (i !== -1) per_run[i] += p.ms_measured - p.ms;
				}
			}
			const in_runs = per_run.reduce((a, b) => a + b, 0);
			meta.overhead = {
				cpu_ms: round2(cpu_over),
				gc_ms: round2(gc_over),
				per_run_ms: n ? round2(in_runs / n) : 0,
				...(n ? { per_run: per_run.map(round2) } : {}),
				note: 'the profiler’s own CPU frames and its share of the GC pauses, taken out of every number in this report: each run loses exactly what fell inside it; the start-up scan of compiled code and the final reads sit outside the runs. The sampler’s own thread and the inspector’s are not visible from inside and are not taken out.'
			};
			if (n && in_runs > 0) {
				meta.runs_measured = [...meta.runs!];
				meta.runs = meta.runs!.map((r, i) => round2(Math.max(0, r - per_run[i])));
			}
		}
		const gc: GcSummary | null = gc_attr
			? {
					count: gc_attr.summary.count,
					total_ms: gc_attr.summary.total_ms,
					max_ms: gc_attr.summary.max_ms
				}
			: cap.gc_pauses.length
				? {
						count: cap.gc_pauses.length,
						total_ms: round2(cap.gc_pauses.reduce((a, c) => a + c, 0)),
						max_ms: round2(Math.max(...cap.gc_pauses))
					}
				: null;
		const raw_json = JSON.stringify(cap.profile);
		let raw: Buffer | string = raw_json;
		try {
			const { gzipSync } = await import('node:zlib');
			raw = gzipSync(raw_json);
		} catch {
			// ok: no zlib (unlikely); the string is kept as it is
		}
		// THE ISLANDS' JS WEIGHT: every module / preload href the page's islands pull, fetched once
		// through the app (a built app's hashed assets; dev URLs are unbundled and say nothing).
		let weights: Record<string, number> | undefined;
		let contents: Record<string, string[]> | undefined;
		let heavy:
			| Record<string, { total: number; top: { name: string; bytes: number }[] }>
			| undefined;
		let barrels: Record<string, ChunkBarrel[]> | undefined;
		let hazards: Record<string, IslandHazard[]> | undefined;
		if (fetch_url && !this.dev) {
			const urls: string[] = [];
			for (const r of island_rows_of(meta)) urls.push(r.module_url, ...r.hints);
			if (urls.length) weights = await weigh_urls(urls, fetch_url, this.#weights);
			// the readable source list behind each hashed chunk (the build's handoff), and its
			// heaviest modules with their rendered bytes
			for (const u of new Set(urls)) {
				const inside = chunk_contents(u);
				if (inside?.length) (contents ??= {})[u] = inside;
				const h = chunk_heavy(u);
				if (h?.top.length) (heavy ??= {})[u] = h;
				const b = chunk_barrels(u);
				if (b?.length) (barrels ??= {})[u] = b;
			}
			// WHAT DRAWS DIFFERENTLY IN THE BROWSER: each island's own components — the lines a mismatch
			// on wake most often comes from (a top-level await, a browser-only value read while
			// rendering). The build scanned them (the site kit's too); an older build's handoff has
			// none, and the app's `.svelte` files in its chunks are read and scanned here instead
			for (const r of island_rows_of(meta)) {
				const built = region_hazards(r.entry);
				if (built?.length) (hazards ??= {})[r.entry] = built;
			}
			if (contents) {
				const read = await this.#source_reader();
				for (const r of island_rows_of(meta)) {
					if (hazards?.[r.entry]) continue;
					const files = new Set<string>();
					for (const u of [r.module_url, ...r.hints])
						for (const f of contents[u] ?? [])
							if (f.endsWith('.svelte') && f.startsWith('src/')) files.add(f);
					const found: IslandHazard[] = [];
					for (const f of files) {
						const src = read(f.slice(4)) ?? read(f);
						if (src)
							for (const h of hydration_hazards(src).slice(0, 3)) found.push({ file: f, ...h });
					}
					if (found.length) (hazards ??= {})[r.entry] = found.slice(0, 5);
				}
			}
		}
		// WHEN THE HEAP GREW and what ran then: the fine series joined to the CPU over the capture
		let alloc: AllocTimeline | undefined;
		if (cap.heap_series?.length) {
			try {
				const window_offset_ms = cap.window ? round2(cap.window.start - cap.perf_start) : 0;
				alloc = alloc_timeline({
					samples: cap.heap_series,
					...(analysis.capture_cpu
						? { running: analysis.capture_cpu }
						: analysis.timeline
							? {
									running: analysis.timeline.segments
										.filter((s) => s.kind === 'cpu')
										.map((s) => ({
											t0: s.t0 + window_offset_ms,
											t1: s.t1 + window_offset_ms,
											label: s.label,
											category: s.category,
											file: s.file
										}))
								}
							: {}),
					gc: (cap.gc_events ?? []).map((g) => ({ t: g.t, ms: g.ms })),
					...(cap.window
						? {
								window: {
									offset_ms: window_offset_ms,
									ms: round2(cap.window.end - cap.window.start)
								}
							}
						: {})
				});
			} catch {
				alloc = undefined;
			}
		}
		// THE INSTANCE WAS NOT ALONE: the other requests that overlapped the profiled window(s)
		let contended: Contention | undefined;
		{
			const windows = cap.runs?.length ? cap.runs : cap.window ? [cap.window] : [];
			if (windows.length) {
				try {
					// the paths the render called on its own server: a ring entry there is the render
					// waiting on itself, and the report says so instead of calling it a stranger
					const self_paths = new Set<string>();
					for (const c of cap.net) {
						const at = c.url.indexOf('://');
						const rest = at === -1 ? c.url : c.url.slice(c.url.indexOf('/', at + 3));
						const q = rest.indexOf('?');
						self_paths.add(q === -1 ? rest : rest.slice(0, q));
					}
					contended = contention({
						requests: this.#ring,
						windows,
						own: this.#ring.filter(
							(e) =>
								e.internal &&
								e.pt !== undefined &&
								windows.some((w) => e.pt! >= w.start - 1 && e.pt! <= w.end)
						),
						self_paths
					});
				} catch {
					contended = undefined;
				}
			}
		}
		this.#reports.set(id, {
			meta,
			analysis,
			heap,
			heap_components,
			net: cap.net,
			spans: cap.spans,
			mem: cap.mem,
			measures: cap.measures,
			gc,
			io: cap.io_ops,
			...(cap.promises ? { promises: cap.promises } : {}),
			call_counts: cap.call_counts,
			raw,
			...(weights ? { weights } : {}),
			...(contents ? { contents } : {}),
			...(heavy ? { heavy } : {}),
			...(barrels ? { barrels } : {}),
			...(hazards ? { hazards } : {}),
			...(gc_attr ? { gc_attr } : {}),
			...(alloc ? { alloc } : {}),
			...(contended ? { contention: contended } : {})
		});
		// the line ledger for a recording with no page-mode follow-up (a caught request, a window):
		// CPU + GC only; page mode builds it after the retention pass, with what a render kept
		if (meta_partial.trigger !== 'page') {
			const s = this.#reports.get(id)!;
			try {
				await this.#lines_for(s, undefined, cap.window?.start);
			} catch {
				// ok: a report without its line ledger; the rest of the report stands
			}
		}
		// page mode writes once, at its end, with every extra in (and waits for the write)
		if (meta_partial.trigger !== 'page') void this.#persist(this.#reports.get(id)!); // ok: never rejects (a failed write is said: devtools_profiler_put_report_failed)
		while (this.#reports.size > this.max_reports) {
			const oldest = this.#reports.keys().next().value;
			if (oldest === undefined) break;
			this.#reports.delete(oldest);
		}
		return id;
	}

	// ---- auth -------------------------------------------------------------
	/** Is this request's visitor the profiler's logged-in user? Its session cookie stays on the
	 *  profiler's path, so a region request carries only the site-wide beacon flag: signed for that
	 *  one session (`#flag_value`), it ends with it. */
	async measures(event: RequestEvent): Promise<boolean> {
		if (this.dev) return true;
		return this.#flag_ok(event);
	}

	/** Does the request carry a live session (any of its `og_profiler` values)? Dev: always. */
	async #has_session(event: RequestEvent): Promise<boolean> {
		if (this.dev) return true;
		for (const value of session_cookie_values(event))
			if (await this.#session_ok(value)) return true;
		return false;
	}

	/** The live session the request carries (its id and expiry), or null. Dev: none needed. */
	async #live_session(event: RequestEvent): Promise<{ nonce: string; exp: string } | null> {
		for (const value of session_cookie_values(event)) {
			if (!(await this.#session_ok(value))) continue;
			const [, nonce, exp] = SESSION_RE.exec(value!)!;
			return { nonce: nonce!, exp: exp! };
		}
		return null;
	}

	/** The beacon flag for one session: `f1.<session id>.<its expiry>.<MAC>`, under a key derived
	 *  for flags alone, so it ends when the session does (expiry, logout, a changed secret). */
	async #flag_value(nonce: string, exp: string): Promise<string> {
		return `f1.${nonce}.${exp}.${await this.#flag_mac(nonce, exp)}`;
	}

	/** The flag MAC (hex): HMAC-SHA256 under a key derived from the secret for flags alone. */
	async #flag_mac(nonce: string, exp: string): Promise<string> {
		this.#flag_key ??= mac_key(this.secret, 'ogygia-profiler-flag-v1');
		return mac_hex(await this.#flag_key, `f1|${nonce}|${exp}`);
	}

	/** The session id of the live beacon flag the request carries, or null: signed by this
	 *  profiler, not expired, its session not logged out. */
	async #flag_session(event: RequestEvent): Promise<string | null> {
		if (!this.secret || !this.#secret_ok) return null;
		const m = FLAG_RE.exec(event.cookies.get('og_profiler_beacon') ?? '');
		if (!m) return null;
		const [, nonce, exp, mac] = m as unknown as [string, string, string, string];
		const now = Date.now();
		const at = Number(exp);
		if (!(at > now && at <= now + SESSION_MS) || this.#revoked.has(nonce)) return null;
		return same_text(await this.#flag_mac(nonce, exp), mac) ? nonce : null;
	}

	/** Does the request carry a live beacon flag? */
	async #flag_ok(event: RequestEvent): Promise<boolean> {
		return (await this.#flag_session(event)) !== null;
	}

	/** The address a key attempt is charged to (one shared budget where the platform has none). */
	#address(event: RequestEvent): string {
		try {
			return event.getClientAddress();
		} catch {
			return ''; // ok: no address on this platform: every attempt shares one budget
		}
	}

	/** Is this the secret (the login form, `x-profiler-key`, `x-profile`)? A wrong key spends the
	 *  address's budget; once it is spent, nothing is compared until the window passes. */
	async #key_ok(provided: string | null | undefined, event: RequestEvent): Promise<boolean> {
		if (this.dev) return true;
		if (!this.secret || !this.#secret_ok || !provided) return false;
		const ip = this.#address(event);
		if (this.#key_fails.over(ip)) return false;
		const ok = await same_key(provided, this.secret);
		if (!ok) this.#key_fails.limited(ip);
		return ok;
	}

	/** The session MAC (hex): HMAC-SHA256 under a key derived from the secret for sessions alone. */
	async #session_mac(nonce: string, exp: string): Promise<string> {
		this.#session_key ??= mac_key(this.secret, 'ogygia-profiler-session-v1');
		return mac_hex(await this.#session_key, `s1|${nonce}|${exp}`);
	}

	/** A new session id: random, expiring after {@link SESSION_MS}, signed. */
	async #new_session(): Promise<string> {
		const nonce = random_id(18);
		const exp = String(Date.now() + SESSION_MS);
		return `s1.${nonce}.${exp}.${await this.#session_mac(nonce, exp)}`;
	}

	/** A session id this profiler signed, not expired, not logged out. */
	async #session_ok(value: string | null | undefined): Promise<boolean> {
		if (!this.secret || !this.#secret_ok || !value) return false;
		const m = SESSION_RE.exec(value);
		if (!m) return false;
		const [, nonce, exp, mac] = m as unknown as [string, string, string, string];
		const now = Date.now();
		const at = Number(exp);
		if (!(at > now && at <= now + SESSION_MS) || this.#revoked.has(nonce)) return false;
		return same_text(await this.#session_mac(nonce, exp), mac);
	}

	/** Logout: every session the request carried ends now, on this instance (another instance
	 *  still has it until it expires; changing the secret ends every session everywhere). */
	async #revoke_sessions(event: RequestEvent): Promise<void> {
		const now = Date.now();
		for (const [nonce, exp] of this.#revoked) if (exp <= now) this.#revoked.delete(nonce);
		for (const value of session_cookie_values(event)) {
			if (!(await this.#session_ok(value))) continue;
			const [, nonce, exp] = SESSION_RE.exec(value)!;
			this.#revoked.set(nonce!, Number(exp));
		}
		while (this.#revoked.size > MAX_REVOKED) {
			const oldest = this.#revoked.keys().next().value;
			if (oldest === undefined) break;
			this.#revoked.delete(oldest);
		}
	}

	/** Cookie header that starts / clears a profiler session (Set-Cookie value). */
	#session_cookie(token: string, event: RequestEvent): string {
		const secure = event.url.protocol === 'https:' ? '; Secure' : '';
		const clear = token === '' ? '; Max-Age=0' : '';
		// SameSite=Lax (not Strict): the login POST is a fetch and the follow-up to the profiler is a
		// navigation; behind a proxy/CDN (Amplify) a Strict cookie can be dropped on that hop, which
		// looked like "the password does nothing". Lax still isn't sent cross-site, and it's HttpOnly.
		// A Max-Age (not a browser-session cookie, lost on some setups) as long as the session lives.
		const age = token === '' ? '' : `; Max-Age=${SESSION_MS / 1000}`;
		return `${SESSION_COOKIE}=${token}; Path=${this.base}; HttpOnly; SameSite=Lax${secure}${clear}${age}`;
	}

	/** The BEACON FLAG: a second cookie, site-wide, carrying no secret — it only tells the handle
	 *  "this browser is the profiler's user, put the beacon tag in its documents". The session
	 *  cookie stays scoped to the profiler's own path (the `/beacon` POST is under it, so the
	 *  runtime's post still carries the real session). Set with the session, cleared with it. */
	async #beacon_cookie(
		session: { nonce: string; exp: string } | null,
		event: RequestEvent
	): Promise<string> {
		const secure = event.url.protocol === 'https:' ? '; Secure' : '';
		if (!session) return `og_profiler_beacon=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
		const value = await this.#flag_value(session.nonce, session.exp);
		const age = Math.max(0, Math.floor((Number(session.exp) - Date.now()) / 1000));
		return `og_profiler_beacon=${value}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${age}`;
	}

	/**
	 * Validate + set up a session. The unlock page POSTs the key here; a match sets the session cookie
	 * and returns to `next`. No HTTP Basic dialog — a plain form + cookie, so the `Authorization` header
	 * is never spent on profiler auth (it stays free, and there's a real Logout).
	 */
	async #login(ctx: RouteCtx): Promise<Response> {
		const raw = await read_capped(ctx.request, MAX_LOGIN_BODY);
		if (raw === null) return ctx.json({ ok: false }, { status: 413 });
		let sent: unknown = null;
		try {
			sent = JSON.parse(new TextDecoder().decode(raw));
		} catch {
			// ok: a body that is not JSON is a failed unlock, answered below
		}
		const body = sent as {
			key?: unknown;
			next?: unknown;
		} | null;
		const key = String(body?.key ?? '');
		const next = this.#safe_next(String(body?.next ?? this.base)); // no open redirect
		// (an address that spent its wrong keys waits out the window, whatever it sends now)
		if (!this.dev && this.#key_fails.over(this.#address(ctx.event!)))
			return ctx.json({ ok: false }, { status: 429, headers: { 'retry-after': '900' } });
		if (!(await this.#key_ok(key, ctx.event!))) return ctx.json({ ok: false }, { status: 401 });
		// `next` carries the after-login marker: if the navigation it drives still arrives without a
		// session, the guard explains why instead of looping back here (#auth_guard).
		const res = ctx.json({
			ok: true,
			next: `${next + (next.includes('?') ? '&' : '?') + AFTER_LOGIN_PARAM}=1`
		});
		// never let a CDN/edge cache this response — a cached login strips Set-Cookie and the session
		// silently never seats (a classic serverless/Amplify symptom: 200 ok, but you loop on login)
		res.headers.set('cache-control', 'no-store, private');
		// ONE Set-Cookie per response: some serverless hosts (a Lambda adapter turning the headers
		// into a plain object) keep only the last of several, and with the beacon flag last, the
		// session was the one lost ("logged in, but no og_profiler arrived"). The flag follows on the
		// next response (#flag_cookie).
		res.headers.append('set-cookie', this.#session_cookie(await this.#new_session(), ctx.event!));
		return res;
	}

	/** false = denied; true = authed; string = authed AND set this cookie */
	async #authed(event: RequestEvent): Promise<boolean> {
		if (!this.ui_enabled) return false;
		if (this.dev) return true;
		// The session cookie (set by the login page) is the browser path; the `x-profiler-key` header is
		// the programmatic path (CI / the MCP tools). No `?key=` — a secret in a URL gets logged & cached.
		// Every `og_profiler` value the browser sent, not only the one Kit's parser picked: a real
		// browser session can carry a large cookie jar from the app it is logged into, and a parser
		// that keeps the FIRST of two same-named cookies, or trips on a neighbour, must not lock the
		// profiler's user out. Any value that is a live session counts.
		if (await this.#has_session(event)) return true;
		return this.#key_ok(event.request.headers.get('x-profiler-key'), event);
	}

	/**
	 * What a request that failed auth carried, for a browser that loops on login — no cookie values,
	 * only facts: did a Cookie header arrive, how big, how many `og_profiler` pairs were in it, and
	 * did Kit's own parser find one. 0 pairs with a header = the cookie never reached the server
	 * (dropped on the way, or the jar is past a proxy's limit); pairs but no parse = a parser problem;
	 * more than one pair = duplicates, one of them stale.
	 */
	#cookie_diagnosis(event: RequestEvent): CookieDiagnosis {
		const raw = event.request.headers.get('cookie');
		return {
			header: raw != null,
			bytes: raw?.length ?? 0,
			pairs: raw ? raw_cookie_values(raw, SESSION_COOKIE).length : 0,
			parsed: event.cookies.get(SESSION_COOKIE) != null
		};
	}

	// ---- profiler UI: an @ogygia/router handler-mode dogfood ---------------
	// The gate does AUTH ONLY — no rendering. /login + /logout manage the session and are always
	// reachable; everything else needs a valid session (dev = open). Every page below is a `view()` the
	// router renders through document(); the profiler itself never touches document/region.
	// Auth is a router GUARD now (#auth_guard); nothing to gate here — just dispatch under the base.
	async #ui(event: RequestEvent): Promise<Response> {
		const res =
			(await this.#router().fetch(event.request, event)) ??
			new Response('Not found', { status: 404 });
		return this.#flag_cookie(event, await gzip_large(event.request, res));
	}

	/** THE BEACON FLAG follows the session, one response later: set on the first response to a
	 *  browser whose session cookie is good and that lacks the flag, cleared on one to a browser with
	 *  the flag and no session. Never beside another Set-Cookie (the login's, the logout's): a host
	 *  that keeps one per response must not lose the session for it. */
	async #flag_cookie(event: RequestEvent, res: Response): Promise<Response> {
		if (this.dev || !this.secret || res.headers.has('set-cookie')) return res;
		// (a flag for another session, an ended one, or an older form is replaced on the next response)
		const session = await this.#live_session(event);
		const flag = await this.#flag_session(event);
		if (session ? flag === session.nonce : !event.cookies.get('og_profiler_beacon')) return res;
		const out = new Response(res.body, res);
		out.headers.append('set-cookie', await this.#beacon_cookie(session, event));
		return out;
	}

	// Auth as a router guard (a pure pre-check): /login + /logout are always reachable (they manage the
	// session); everything else needs a valid session (dev = open; no-secret prod = hidden → 404). No
	// `?key=` (a key in a URL gets logged/cached/shared) — the browser uses the login cookie, and
	// programmatic access uses the `x-profiler-key` header. The /login POST seats the cookie; this guard
	// never touches the response.
	async #auth_guard(ctx: RouteCtx): Promise<Response | undefined> {
		const rel = ctx.url.pathname.slice(this.base.length).replace(TRAILING_SLASH_RE, '') || '/';
		// `/login` + `/logout` manage the session. The BARE report page (`/report/<id>`, no `.json`/
		// `.dump`/`/raw` suffix) is PUBLIC: a recipient with a share link renders it entirely client-side
		// from the URL `#fragment` (no account). Its SERVER data is still gated — the page's own load
		// only returns a stored report when `authed()`, so an unauth visitor can't read reports by
		// guessing the short id, and the suffixed data endpoints stay behind auth below.
		if (rel === '/login' || rel === '/logout' || /^\/report\/[^/.]+$/.test(rel)) return;
		if (await this.#authed(ctx.event!)) return; // allow
		if (this.ui_enabled && this.secret && !this.dev) {
			const after_login = ctx.url.searchParams.has(AFTER_LOGIN_PARAM);
			const diag = this.#cookie_diagnosis(ctx.event!);
			// A browser that sent a session cookie, or that just logged in, and still is not authed: say
			// why in the server log (facts only, never a cookie value) — the one line that tells a dropped
			// cookie, a duplicate and a wrong secret apart.
			if (after_login || diag.pairs > 0)
				warn('devtools_profiler_session_rejected', {
					path: ctx.url.pathname,
					diagnosis: JSON.stringify(diag),
					reason: describe_cookie_diagnosis(diag)
				});
			const target = new URL(ctx.url);
			target.searchParams.delete(AFTER_LOGIN_PARAM);
			const next = encodeURIComponent(target.pathname + target.search);
			// Right after a successful login: not the login page again (a loop), the login page WITH the
			// diagnosis.
			return ctx.redirect(
				`${this.base}/login?next=${next}${after_login ? `&${LOGIN_FAILED_PARAM}=1` : ''}`
			);
		}
		return new Response('Not found', { status: 404 });
	}

	// The profiler route tree. Built once. Auth is a top layer `load` (Kit-idiomatic — a redirect/404
	// from the load short-circuits every page below it); `/login` + `/logout` exempt themselves inside
	// it. Each page endpoint returns a `view()` the router renders through document(); method routing
	// rides `.get(...).post(...)` on /login and /view. `base` makes patterns base-relative; `miss` gives
	// the profiler its own 404 for anything else under the base.
	#routes: Router | undefined;
	#router(): Router {
		// The route tree lives in profiler-router.ts (so its $infer type is importable by the UI); the
		// host just supplies the handlers as a typed Deps boundary.
		return (this.#routes ??= build_profiler_router({
			base: this.base,
			auth_guard: (c) => this.#auth_guard(c),
			authed: (c) => this.#authed((c as { event?: RequestEvent }).event!),
			beacon: (c) => this.#beacon(c),
			replay: (id, c) => this.#replay(id, c),
			dashboard: (c) => this.#dashboard(c.url.searchParams.get('by')),
			run_page: (c) => this.#run_page(c),
			record_page: (c) => this.#record_page(c),
			window_start: (c) => this.#window_start(c),
			window_stop: (c) => this.#window_stop(c),
			reset: (c) => this.#reset(c),
			status: () => ({
				recording: this.#recorder.held,
				inflight: this.#inflight,
				rss_mb: Math.round(process.memoryUsage().rss / 1048576),
				reports: this.#reports.size
			}),
			login_props: (c) => ({
				base: this.base,
				next: this.#safe_next(c.url.searchParams.get('next')),
				// The login page's own request carries the same cookie jar (the session cookie's path
				// covers it), so its diagnosis is the failed request's.
				session_problem: c.url.searchParams.has(LOGIN_FAILED_PARAM)
					? describe_cookie_diagnosis(
							this.#cookie_diagnosis((c as { event?: RequestEvent }).event!)
						)
					: null
			}),
			login: (c) => this.#login(c),
			logout: (c) => this.#logout(c),
			upload: (c) => this.#upload(c),
			report_stored: (id) => this.#reports.get(id ?? ''),
			report_load: (id) => this.#report_load(id),
			list_stored: (limit) => this.#list_stored(limit),
			login_url: (c) =>
				this.ui_enabled && this.secret && !this.dev
					? `${this.base}/login?next=${encodeURIComponent(c.url.pathname)}`
					: null,
			report_view: (stored) => this.#report_view(stored),
			report_json: (stored) => this.#report_json(stored),
			report_dump_json: (stored) => this.#report_dump_json(stored),
			report_html: (stored, c) => this.#report_html(stored, c),
			report_posted: (c, as) => this.#report_posted(c, as),
			report_raw: (stored) => this.#report_raw(stored),
			compare: (a, b) => this.#compare(a, b),
			site: (c) => this.#site(c),
			source: (c) => this.#source(c)
		}) as Router);
	}

	/**
	 * THE TIMELINE INPUT: the one request's window + every call it waited on. Net calls as they
	 * are. I/O primitives only when they are the app's own wait — the same rule as the "Waiting by
	 * function" table: the op must have a resolved app caller (an unattributed one is undici's
	 * socket timer, a response compressor's zlib stream, the recorder's own timer; a WASM caller
	 * is a library's internals) — and an op that sits inside a net call's span is the other end of
	 * that same call (an in-process API's timer on a self-fetch); the net call already says it.
	 * Each call carries the phase of the code that started it, from the caller's file.
	 */
	#timeline_input(cap: WindowCapture) {
		const w = cap.window!;
		const phase_of = (caller?: string) => {
			const m = caller ? CALLER_FILE_RE.exec(caller) : null;
			return m
				? (phase_of_frame({ name: '', url: m[1], line: 0, category: 'app' }) ?? undefined)
				: undefined;
		};
		const net = cap.net
			.filter((c) => c.ms >= 0)
			.map((c) => ({ start: c.start, end: c.start + c.ms + (c.body_ms ?? 0), c }));
		const inside_a_call = (s: number, e: number) =>
			net.some((n) => s >= n.start - 2 && e <= n.end + 2);
		const overlaps_a_call = (s: number, e: number) => net.some((n) => s < n.end && e > n.start);
		// an op started by a `+server` route handler while one of our calls was in flight is the
		// server side of a self-fetch (the devtools lab's in-process APIs): the net call already says it
		const is_handler_side = (o: IoOp) =>
			!!o.caller && SERVER_ROUTE_FILE_RE.test(o.caller) && overlaps_a_call(o.start, o.start + o.ms);
		return {
			perf_start: cap.perf_start,
			window: w,
			...(cap.runs ? { runs: cap.runs } : {}),
			...(cap.set_aside?.length ? { set_aside: cap.set_aside } : {}),
			// EVERY resource the hooks saw, waits or not, open or not: what a gap on the timeline can
			// be named after ("pending: Immediate from drainQueue") — the sweep's own list is the
			// filtered one above
			pending: cap.io_ops
				.filter((o) => o.start <= w.end && o.start + Math.max(o.ms, 0) >= w.start)
				.map((o) => ({
					start: o.start,
					end: o.open ? w.end : o.start + o.ms,
					label: o.caller ? `${o.type} from ${o.caller}` : o.type,
					kind: io_kind(o.type)
				})),
			calls: [
				// spans first: the timeline draws them as the overlay a call or a gap sits inside
				...cap.spans
					.filter((s) => !s.open && s.ms >= 0)
					.map((s) => ({
						start: s.start,
						ms: s.ms,
						label: s.name,
						kind: 'span',
						caller: s.caller,
						phase: phase_of(s.caller)
					})),
				...cap.net.map((c) => ({
					start: c.start,
					ms: c.ms < 0 ? -1 : c.ms + (c.body_ms ?? 0),
					label: label_call(c.method, c.url),
					kind: 'net',
					caller: c.caller,
					phase: phase_of(c.caller),
					...(c.callers ? { callers: c.callers } : {}),
					...(c.timings ? { timings: c.timings } : {}),
					...(c.ms >= 0 && c.body_ms ? { body_ms: c.body_ms } : {})
				})),
				...cap.io_ops
					.filter(
						(o) =>
							!o.open &&
							o.ms >= 0.5 &&
							o.type !== 'Immediate' &&
							o.type !== 'TickObject' &&
							!!o.caller &&
							!o.caller.startsWith('/wasm/') &&
							!o.caller.includes('(/wasm/') &&
							!inside_a_call(o.start, o.start + o.ms) &&
							!is_handler_side(o)
					)
					.map((o) => ({
						start: o.start,
						ms: o.ms,
						label: `${io_kind(o.type)}${o.caller ? ` · ${o.caller}` : ''}`,
						kind: io_kind(o.type),
						caller: o.caller,
						phase: phase_of(o.caller)
					}))
			]
		};
	}

	/**
	 * The report as ONE self-contained HTML file (profiler/standalone.ts): the page is rendered
	 * through this very server (a self-request, marked internal so it is not logged as traffic),
	 * then every stylesheet, the runtime and every island chunk it reaches are fetched the same way
	 * and inlined. Needs a BUILT app: a dev server's module graph is Vite's, hundreds of unbundled
	 * files with transforms — not a thing one file can carry.
	 */
	async #report_html(stored: StoredReport, ctx: RouteCtx): Promise<Response> {
		if (this.dev) {
			return new Response(
				`The standalone HTML export needs a built app (vite build + preview, or your production deploy): on the dev server the page’s code is hundreds of unbundled modules. Export the .ogp here and open it on a built server, or run the export there.`,
				{ status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } }
			);
		}
		const origin = ctx.url.origin;
		const page_url = `${origin}${this.base}/report/${stored.meta.id}`;
		const headers: Record<string, string> = { 'x-og-profiler-internal': '1' };
		if (this.secret) headers['x-profiler-key'] = this.secret;
		// IN-PROCESS first: Kit's own fetch answers a same-site request inside this instance. A plain
		// fetch to the origin goes back out through the host's CDN and, on a serverless host, lands on
		// another instance that does not hold this report. The static chunks load either way.
		const load = async (url: string): Promise<string | null> => {
			for (const f of ctx.fetch === fetch ? [fetch] : [ctx.fetch, fetch]) {
				try {
					const res = await f(url, { headers });
					if (res.ok) return await res.text();
				} catch {
					// ok: this way could not fetch it; the next way is tried
				}
			}
			return null;
		};
		const html = await load(page_url);
		if (html === null) return new Response('Could not render the report page.', { status: 502 });
		const { build_standalone } = await import('./standalone.ts');
		try {
			const out = await build_standalone(html, { page_url, load });
			return new Response(out, {
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'content-disposition': `attachment; filename="ogygia-profile-${stored.meta.id}.html"`,
					'cache-control': 'no-store'
				}
			});
		} catch (e) {
			return new Response(e instanceof Error ? e.message : 'standalone export failed', {
				status: 500
			});
		}
	}

	/** A report's representations (the standalone file, the agent JSON, the plain dump) from a report
	 *  the request carries: the page's .ogp bytes or the browser's kept copy. On a serverless host the
	 *  instance that made the report is rarely the one a later request lands on; with the report in
	 *  the request, any instance answers. It is held in this instance's memory under its own id, so
	 *  the in-process render of the report page (the standalone file) finds it too. */
	async #report_posted(ctx: RouteCtx, as: 'html' | 'json' | 'dump' | 'ogp'): Promise<Response> {
		const id = ctx.params.id;
		if (!id) return new Response('No report id.', { status: 400 });
		// the page's own .ogp bytes (this server's key opens them), or a kept dump as gzipped JSON:
		// never raw JSON, which is several MB and over a host's request-body cap
		let dump: unknown;
		try {
			const raw = await read_capped(ctx.request, MAX_POSTED_REPORT);
			if (raw === null) return new Response('That report is too large.', { status: 413 });
			if ((ctx.request.headers.get('content-type') ?? '').startsWith('application/octet-stream')) {
				const bytes = recover_ogp_bytes(raw);
				if (!is_ogp(bytes))
					return new Response('That is not an ogygia .ogp report.', { status: 400 });
				dump = await ogp_decode(bytes, this.secret);
			} else if (ctx.request.headers.get('x-og-encoding') === 'gzip') {
				// (under the .ogp lane's cap: test/profiler-report-gzip-cap.test.ts)
				const { gunzipSync } = await import('node:zlib');
				let json: Uint8Array;
				try {
					json = gunzipSync(raw, { maxOutputLength: OGP_MAX_UNPACKED });
				} catch (e) {
					if ((e as { code?: unknown })?.code !== 'ERR_BUFFER_TOO_LARGE') throw e;
					throw new OgygiaError('devtools_profiler_upload_too_large', { limit: OGP_MAX_UNPACKED });
				}
				dump = JSON.parse(new TextDecoder().decode(json));
			} else {
				dump = JSON.parse(new TextDecoder().decode(raw));
			}
		} catch (e) {
			if (e instanceof OgygiaError && e.code === 'devtools_profiler_upload_too_large')
				return new Response(e.message, { status: 413 });
			return new Response('The request carried no report this server can open.', { status: 400 });
		}
		if (!is_dump(dump))
			return new Response('That is not an ogygia profiler report.', { status: 400 });
		let stored = this.#reports.get(id);
		if (!stored) {
			stored = this.#report_from_dump({ ...dump, meta: { ...dump.meta, id } });
			this.#reports.set(id, stored);
			while (this.#reports.size > this.max_reports) {
				const oldest = this.#reports.keys().next().value;
				if (oldest === undefined) break;
				this.#reports.delete(oldest);
			}
		}
		if (as === 'html') return this.#report_html(stored, ctx);
		if (as === 'json') return this.#report_json(stored);
		if (as === 'ogp') return this.#ogp_response(id, stored);
		return this.#report_dump_json(stored);
	}

	/** Two stored reports side by side (compare.ts); a 404 when either has expired. */
	/** THE DATA RIVER for a page report: the last run's calls on their load lanes, what each load's
	 *  source returns, what each island reads (the build's page keys), the seed's bytes per key. */
	async #river_for(
		stored: StoredReport,
		body: string,
		last_window: { start: number; end: number } | undefined
	): Promise<River | undefined> {
		const tl = stored.analysis.timeline;
		if (!tl) return undefined;
		const lanes = tl.lanes ?? [];
		if (!lanes.length && !stored.net.length) return undefined;
		// the keys each load returns, from its source (the lane's file, relative to src or the cwd)
		const read = await this.#source_reader();
		const lane_files = [...new Set(lanes.map((l) => l.file))];
		const river_lanes = lane_files.map((file) => {
			const src = read(file);
			return { file, keys: src ? load_return_keys(src) : null };
		});
		// the calls of the LAST run only (the window's calls span every run), on the lane that made them
		const calls = stored.net
			.filter((c) => !last_window || (c.start >= last_window.start && c.start <= last_window.end))
			.map((c) => {
				const text = [c.caller_site?.file ?? '', ...(c.callers ?? []), c.caller ?? ''].join(' ');
				const lane = load_lane_of(text)?.file ?? null;
				return {
					lane:
						lane && lane_files.includes(lane)
							? lane
							: (lane_files.find((f) => lane && (f.endsWith(lane) || lane.endsWith(f))) ?? null),
					label: `${c.method} ${c.url}`,
					ms: Math.max(c.ms, 0) + (c.body_ms ?? 0)
				};
			});
		// the islands and the page.data keys the build says each reads
		const by_entry = new Map<string, { name: string; keys: string[] | null }>();
		for (const r of island_rows_of(stored.meta)) {
			if (by_entry.has(r.entry)) continue;
			let keys: string[] | null = null;
			const dev = await this.#dev_island_keys(r.entry);
			if (dev) keys = dev.keys === 'all' ? null : (dev.keys ?? []);
			else
				try {
					keys = region_page_keys(r.entry);
				} catch {
					keys = null;
				}
			by_entry.set(r.entry, { name: island_name(r), keys });
		}
		// the seed's bytes per key (JSON lane; a devalue seed measures as nothing per key)
		const seed_text = page_seed(body);
		const seed = seed_text !== null ? seed_key_bytes(seed_text) : {};
		if (!calls.length && !Object.keys(seed).length && !by_entry.size) return undefined;
		return build_river({ calls, lanes: river_lanes, islands: [...by_entry.values()], seed });
	}

	/** THE LINE LEDGER (ledger.ts): the app lines that cost the most — CPU per line, the bytes each
	 *  allocated and the GC that caused, what a render kept — joined per line, with the code read
	 *  from the source map's embedded copy (so it shows on a deployed host). Then THE PATTERNS
	 *  (patterns.ts): the known slow shapes recognised on those lines. Both land on the report. */
	/** `w0`: the profiled window's start (performance.now()), the clock the timeline's await graph
	 *  counts from; the waits' critical-path check lines the chains up on it */
	async #lines_for(
		s: StoredReport,
		uninlined_profile?: CpuProfile,
		w0?: number,
		stable?: ReadonlySet<string>,
		wait_runs?: Readonly<Record<string, number[]>>,
		almost?: ReadonlyMap<string, string>
	): Promise<void> {
		const resolver = await this.#make_resolver();
		// the call-count render's CPU profile (inlining off): whose share a merged line holds
		let uninlined: FrameStat[] | undefined;
		if (uninlined_profile) {
			try {
				uninlined = analyze(
					uninlined_profile,
					resolver,
					undefined,
					undefined,
					undefined,
					this.#module_hint
				).functions;
			} catch {
				uninlined = undefined;
			}
		}
		// every analysed frame once: a component row can carry hot lines its function row did not
		const fns = new Map<string, FrameStat>();
		for (const f of s.analysis.functions) fns.set(f.key, f);
		for (const c of s.analysis.components) {
			const e = fns.get(c.key);
			if (!e || (!e.lines?.length && c.lines?.length)) fns.set(c.key, c);
		}
		const ledger = build_ledger({
			functions: [...fns.values()],
			makers: s.gc_attr?.makers,
			retained: s.retained?.sites,
			...(s.growth?.sites
				? {
						grown: {
							renders: s.growth.renders,
							sites: s.growth.sites,
							...(s.growth.half_sites && s.growth.half_renders
								? { half: { renders: s.growth.half_renders, sites: s.growth.half_sites } }
								: {})
						}
					}
				: {}),
			code: (p, l) => resolver?.source_lines(p, l, l)?.lines[0],
			source: resolver ? (p, a, b) => resolver.source_lines(p, a, b) : undefined,
			...(uninlined
				? { uninlined, renders: s.meta.trigger === 'page' ? s.meta.runs?.length || 1 : 1 }
				: {}),
			// the pattern finder reads the long list (a slow shape on the 41st costliest line is still
			// one); the report keeps and shows the top LEDGER_SHOWN
			limit: LEDGER_FOR_PATTERNS
		});
		const source = resolver
			? (p: string, a: number, b: number) => resolver.source_lines(p, a, b)
			: undefined;
		// a built chunk's line named by its source module (no sourcemap) — BEFORE the patterns read the
		// ledger: a compiled component's line is known by its .svelte module
		for (const l of ledger) this.#label_module(l);
		if (ledger.length) s.ledger = ledger.slice(0, LEDGER_SHOWN);
		const renders = s.meta.trigger === 'page' ? s.meta.runs?.length || 1 : 1;
		// the heap's room, for a leak's countdown ("full after about N more requests")
		let heap: { limit_bytes: number; used_bytes: number; function?: boolean } | undefined;
		try {
			const st = (await import('node:v8')).getHeapStatistics();
			heap = { limit_bytes: st.heap_size_limit, used_bytes: st.used_heap_size };
			// on AWS Lambda (Amplify's SSR runs there) the ceiling is the function's memory size, and the
			// process is killed at it whatever the heap's own limit says
			const fn_mb = Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE);
			if (fn_mb > 0 && fn_mb * 1024 * 1024 < heap.limit_bytes) {
				heap = {
					limit_bytes: fn_mb * 1024 * 1024,
					used_bytes: process.memoryUsage().rss,
					function: true
				};
			}
		} catch {
			// ok: no node:v8 (not Node): no memory limit to read
		}
		const patterns = ledger.length
			? find_patterns({
					ledger,
					functions: [...fns.values()],
					source,
					renders,
					heap,
					growth: s.growth
				})
			: [];
		// the waits: every finished call with the app line that made it, network and I/O alike
		const calls: WaitCall[] = [];
		for (const c of s.net) {
			if (c.ms < 0 || !c.caller_at) continue;
			const { host, tpl } = path_template(c.url);
			calls.push({
				start: c.start,
				ms: c.ms + (c.body_ms ?? 0),
				target: `${c.method} ${host}${tpl}`,
				at: c.caller_at,
				...(c.outer_at ? { outer: c.outer_at } : {}),
				scope: c.path,
				...(c.method === 'GET' || c.method === 'HEAD' ? { exact: `${c.method} ${c.url}` } : {}),
				...(c.bytes !== undefined ? { bytes: c.bytes } : {}),
				...(c.personal ? { personal: true } : {}),
				...(c.headers?.['cache-control'] ? { cache: c.headers['cache-control'] } : {})
			});
		}
		for (const o of s.io ?? []) {
			const target = WAIT_TARGET[o.type];
			if (!target || o.open || !o.caller_at) continue;
			calls.push({ start: o.start, ms: o.ms, target, at: o.caller_at });
		}
		const waits = find_wait_patterns({ calls, source });
		// the waits' saving on the CRITICAL PATH: the render's await graph replayed with each chain
		// started together; a chain with something as long running beside it saves less than its sum
		const tl = s.analysis.timeline;
		for (const p of waits) {
			if (p.kind !== 'waits-in-a-row' || w0 === undefined || !tl) continue;
			const on_path = wait_save_on_path(p, tl.awaits, tl.window_ms, w0);
			if (!on_path || on_path.save_ms >= p.save_ms * 0.8) continue;
			p.naive_save_ms = p.save_ms;
			p.save_ms = on_path.save_ms;
			const bound = on_path.bound_by
				? `: ${on_path.bound_by} runs about as long beside them and still sets the end`
				: ': other work runs as long beside them';
			p.evidence = `${p.evidence}. Started together they would save ${p.naive_save_ms} ms of waiting, but only about ${on_path.save_ms} ms comes off the render${bound}`;
		}
		patterns.push(...waits);
		// the same answer every render: the GETs that returned identical bytes in each profiled run
		if (stable?.size) {
			const same = find_same_answers({
				calls,
				stable,
				source,
				...(tl?.awaits && w0 !== undefined ? { awaits: tl.awaits, w0 } : {})
			});
			if (same) patterns.push(same);
		}
		// ...and ALMOST the same: the answers that changed between renders only in a stamp
		if (almost?.size) {
			const near = find_same_answers({
				calls,
				stable: new Set(almost.keys()),
				almost,
				source,
				...(tl?.awaits && w0 !== undefined ? { awaits: tl.awaits, w0 } : {})
			});
			if (near) patterns.push(near);
		}
		// caches that never hit: each costly memo's miss-path helpers, counted by V8, against its calls
		if (source && Object.keys(s.call_counts).length) {
			const cold = find_cold_caches({
				functions: [...fns.values()],
				call_counts: s.call_counts,
				source
			});
			if (cold) patterns.push(cold);
		}
		// ogygia's own: the island lines that take page.data whole, and what the seed ships for it
		const og = own_requests(s.meta).find((r) => r.og?.seed)?.og;
		const whole = s.lineage?.components.filter((c) => c.island && c.whole && c.whole_line) ?? [];
		if (og?.seed && whole.length) {
			const read = await this.#source_reader();
			const readers: WholeReader[] = [];
			for (const c of whole) {
				const lines = read(c.file)?.split('\n');
				const at = c.whole_line!;
				if (!lines?.[at - 1]) continue;
				const from = Math.max(1, at - 2);
				readers.push({
					name: c.name,
					file: c.file,
					line: at,
					code: lines[at - 1].trim(),
					context: { start: from, lines: lines.slice(from - 1, at + 2) }
				});
			}
			const top = og.seed.keys.find((k) => k.shipped);
			const p = seed_whole_pattern(
				readers,
				og.seed_bytes,
				top ? { key: top.key, bytes: top.bytes } : undefined
			);
			if (p) patterns.push(p);
		}
		// THE SAME WORK EVERY REQUEST: load lines that read only the module (source), priced by their
		// own CPU plus the whole time of the functions they run (named only on such lines)
		const load_files = [...new Set((s.analysis.timeline?.lanes ?? []).map((l) => l.file))];
		if (load_files.length) {
			const read = await this.#source_reader();
			const work: ConstantWork[] = [];
			// a line that feeds only keys nothing reads is work to DELETE (the unread finding says so),
			// not to move: counting it here too claims its time twice
			const unread_keys = new Set(
				(s.lineage?.keys ?? []).filter((k) => k.verdict === 'unread').map((k) => k.key)
			);
			const feeds_only_unread = (file: string, line: number) => {
				const fed = (s.lineage?.sources ?? []).filter(
					(x) => x.from === file && x.lines.includes(line)
				);
				return fed.length > 0 && fed.every((x) => unread_keys.has(x.key));
			};
			for (const file of load_files) {
				const src = read(file);
				if (!src) continue;
				const lines = src.split('\n');
				for (const w of constant_work(src)) {
					if (feeds_only_unread(file, w.line)) continue;
					const own = ledger
						.filter((l) => l.line === w.line && (l.file.endsWith(file) || file.endsWith(l.file)))
						.reduce((t, l) => t + l.cpu_ms + l.lib_ms, 0);
					// a called function by the module the load imports it from (or the load file itself): not
					// every function of that name in the app (`format` in five files)
					const called = w.calls.reduce((t, c) => {
						const mod = imported_from(src, c, file);
						return (
							t +
							[...fns.values()]
								.filter(
									(f) =>
										f.name === c && f.category === 'app' && !!mod && f.path.includes(`/${mod}.`)
								)
								.reduce((u, f) => u + f.total_ms, 0)
						);
					}, 0);
					const from = Math.max(1, w.line - 2);
					work.push({
						path: file,
						file,
						line: w.line,
						code: lines[w.line - 1].trim(),
						names: w.names,
						calls: w.calls,
						cpu_ms: own + called,
						context: { start: from, lines: lines.slice(from - 1, w.line + 2) }
					});
				}
			}
			const p = same_work_pattern(work, renders);
			if (p) {
				// THE CHANGE, WRITTEN: the costly constant statements of that load and what they read
				// (`joined` needs `valid`), moved unchanged to the file's top level right above the load —
				// only when hoist_plan finds the move cannot change what the file does
				const file = p.sites[0].path;
				const src = read(file);
				const plan = src ? hoist_plan(src) : null;
				if (src && plan) {
					const lines = src.split('\n');
					const stmt = (x: { line: number; end: number }) => lines.slice(x.line - 1, x.end);
					const dedent = (ls: string[]) =>
						ls.map((l) => (l.startsWith('\t') ? l.slice(1) : l.startsWith('  ') ? l.slice(2) : l));
					p.sites[0].rewrite = {
						file,
						line: plan.stmts[0].line,
						before: plan.stmts.map((x) => stmt(x).join('\n')).join('\n\t// …\n'),
						after: `// at the top level, above line ${plan.above} (\`export … load\`), unchanged, and gone from load():\n${plan.stmts.map((x) => dedent(stmt(x)).join('\n')).join('\n')}`
					};
				}
				patterns.push(p);
			}
		}
		// THE SAME DOCUMENT EVERY REQUEST: every render's bytes matched, and nothing read is the
		// visitor's (a load taking cookies / locals / the request or the whole event; a call that carried
		// a cookie or an authorization header) — the whole render is the saving
		// (a render of a few ms is not worth a cache's staleness) — and THE SAME BUT FOR A FEW PARTS:
		// the renders differ only in a handful of small groups (≤ 5 % of the document, ≤ 6 groups)
		// WHERE EACH CHANGING ATTRIBUTE IS SET: the page's component files that give it a value from
		// code on one of its tags; none of yours → a library stamps it as it renders
		if (s.meta.doc_diff?.groups.some((g) => g.attr && !g.sources && !g.library)) {
			const read = await this.#source_reader();
			// one spelling per file: src-relative (`lib/x.svelte`), whether the profile named it
			// `src/lib/…`, `…/app/src/lib/…` or the lineage `lib/…`
			const norm = (f: string) => {
				const at = f.lastIndexOf('/src/');
				return at !== -1 ? f.slice(at + 5) : f.startsWith('src/') ? f.slice(4) : f;
			};
			const files = [
				...new Set([
					...(s.lineage?.components ?? []).map((c) => norm(c.file)),
					...s.analysis.components.filter((c) => c.url.endsWith('.svelte')).map((c) => norm(c.url))
				])
			];
			for (const g of s.meta.doc_diff.groups) {
				if (!g.attr || g.attr.includes(',')) continue;
				const tags = g.tag.split(', ');
				const found: { file: string; line: number; code: string }[] = [];
				let mentioned = false;
				for (const f of files) {
					const src = read(f);
					if (!src) continue;
					if (src.includes(g.attr)) mentioned = true;
					for (const x of attr_sites(src, g.attr, tags))
						if (found.length < 3) found.push({ file: f, ...x });
				}
				if (found.length) g.sources = found;
				// "a library stamps it" only when no file of yours even names it (a spread or a form the
				// search misses would otherwise read as a library's)
				else if (!mentioned) g.library = true;
			}
		}
		// A PRERENDERED PAGE (`export const prerender = true` on its route, the nearest file deciding):
		// production serves its built HTML, rendering nothing per request — the "cache it" advice is
		// moot, and the report says what its numbers are
		if (s.meta.trigger === 'page' && s.meta.prerendered === undefined) {
			const read = await this.#source_reader();
			// the route's folder: Kit's route id of the profiled render (a build without source maps
			// names no file), else the page's own file the timeline or the lineage saw
			// (the timed renders are the profiler's own, internal requests: by the page's path)
			const reqs = s.meta.requests ?? [];
			const route =
				s.meta.run_route ??
				(
					reqs.find((r) => r.route && r.path.split('?')[0] === s.meta.page?.split('?')[0]) ??
					reqs.find((r) => r.route)
				)?.route;
			const leaf =
				[...new Set((s.analysis.timeline?.lanes ?? []).map((l) => l.file))].find((f) =>
					f.includes('+page')
				) ?? (s.lineage?.components ?? []).find((c) => c.file.endsWith('+page.svelte'))?.file;
			const dir = route
				? `routes${route === '/' ? '' : route}`
				: leaf
					? leaf.slice(0, leaf.lastIndexOf('/'))
					: '';
			if (s.meta.run_static || (dir && route_prerendered(read, dir))) s.meta.prerendered = true;
		}
		const near =
			s.meta.doc_diff &&
			s.meta.doc_diff.differing <= s.meta.doc_diff.tokens * 0.05 &&
			s.meta.doc_diff.groups.length <= 6
				? s.meta.doc_diff
				: undefined;
		// (an error page repeated is not a page to cache; a prerendered one is a file already)
		if (
			!s.meta.prerendered &&
			(s.meta.same_document || near) &&
			s.meta.runs?.length &&
			Math.min(...s.meta.runs) >= 5 &&
			(s.meta.run_status ?? 200) === 200
		) {
			const read = await this.#source_reader();
			const files = [...new Set((s.analysis.timeline?.lanes ?? []).map((l) => l.file))];
			const VISITOR = new Set(['cookies', 'locals', 'request', 'getClientAddress', 'platform']);
			let visitor = s.net.some((c) => c.personal);
			// EVERY load on the route's path, not only the ones the timeline saw: a layout load that
			// reads a cookie in under a sample, making no call, is no lane — and still per visitor
			const route_files = new Set(files);
			const leaf =
				files.find((f) => f.includes('+page')) ??
				(s.lineage?.components ?? []).find((c) => c.file.endsWith('+page.svelte'))?.file;
			if (leaf) {
				let dir = leaf.slice(0, leaf.lastIndexOf('/'));
				let first = true;
				while (dir) {
					const names = [
						...(first ? ['+page.server.ts', '+page.server.js', '+page.ts', '+page.js'] : []),
						'+layout.server.ts',
						'+layout.server.js',
						'+layout.ts',
						'+layout.js'
					];
					for (const n of names)
						if (read(`${dir}/${n}`) !== undefined) route_files.add(`${dir}/${n}`);
					first = false;
					const up = dir.lastIndexOf('/');
					if (up === -1) break;
					dir = dir.slice(0, up);
				}
			}
			for (const f of route_files) {
				const src = read(f);
				const ins = src ? load_inputs(src) : null;
				if (ins?.some((n) => VISITOR.has(n) || n.startsWith('*'))) visitor = true;
			}
			if (!visitor) {
				const page_file = files.find((f) => f.includes('+page')) ?? files[0] ?? s.meta.page ?? '';
				const code = page_file
					? read(page_file)
							?.split('\n')
							.find((l) => l.includes('export') && l.includes('load'))
							?.trim()
					: undefined;
				const runs = [...s.meta.runs].sort((a, b) => a - b);
				const render_ms = runs[Math.floor(runs.length / 2)];
				// (what the response says that keeps every shared cache out: the header advice waits on it)
				const cc = s.meta.run_cache_control;
				const shut = cc
					?.toLowerCase()
					.split(',')
					.some((d) => d.trim() === 'private' || d.trim() === 'no-store');
				if (s.meta.same_document)
					patterns.push(
						same_document_pattern({
							file: page_file,
							render_ms,
							bytes: s.meta.run_bytes ?? 0,
							...(code ? { code } : {}),
							...(s.meta.run_sets_cookie || shut
								? {
										blocked: {
											...(s.meta.run_sets_cookie ? { cookie: true } : {}),
											...(shut ? { cache_control: cc } : {})
										}
									}
								: {})
						})
					);
				else if (near)
					patterns.push(
						almost_same_document_pattern({
							file: page_file,
							render_ms,
							diff: near,
							...(code ? { code } : {})
						})
					);
			}
		}
		// A COMPONENT RENDERED ONCE PER ITEM: its count (V8's, one render) → the `{#each}` in its parent
		// that renders it → the page-data key the loop walks → the load line that makes that list
		{
			const read = await this.#source_reader();
			const comps = s.analysis.components;
			const norm = (f: string) => (f.startsWith('src/') ? f.slice(4) : f);
			const blocks_of = new Map<string, ReturnType<typeof each_blocks>>();
			const items: PerItemRender[] = [];
			for (const c of comps) {
				if (!c.calls || c.calls < 20 || !c.parent) continue;
				// the loop is in the parent — or, when the parent is a wrapper (an island's host, a
				// layout piece), a few levels up
				let file = '';
				let src: string | undefined;
				let b: ReturnType<typeof each_blocks>[number] | undefined;
				let up: string | undefined = c.parent;
				for (let hop = 0; up && hop < 4 && !b; hop++) {
					const parent = comps.find((p) => p.name === up);
					up = parent?.parent;
					if (!parent) continue;
					// its `.svelte` file: the frame's own url, or (a build without maps, where the frame
					// is its chunk) the module the build put at that chunk line
					let own: string | undefined = parent.url.endsWith('.svelte') ? parent.url : undefined;
					if (!own && parent.path) {
						const id = this.#module_find(parent.path, parent.line);
						if (id?.endsWith('.svelte')) own = id;
					}
					if (!own) continue;
					file = norm(own);
					src = read(file);
					if (!src) continue;
					if (!blocks_of.has(file)) blocks_of.set(file, each_blocks(src));
					b = blocks_of.get(file)!.find((x) => x.components.includes(c.name));
				}
				if (!b || !src) continue;
				const lines = src.split('\n');
				const from = Math.max(1, b.line - 2);
				// the key's last line before the return entry: where the list gets its final length
				let made_at: PerItemRender['made_at'];
				for (const x of b.key ? (s.lineage?.sources ?? []).filter((y) => y.key === b.key) : []) {
					// (a key made right in the return, `catalog: catalog()`, has that one line)
					const sorted = [...x.lines].sort((m, n) => n - m);
					const at = sorted[1] ?? sorted[0];
					const code = at ? read(x.from)?.split('\n')[at - 1]?.trim() : undefined;
					if (at && code) made_at = { path: x.from, file: x.from, line: at, code };
				}
				items.push({
					component: c.name,
					instances: c.calls,
					total_ms: c.total_ms,
					each: {
						path: file,
						file,
						line: b.line,
						code: lines[b.line - 1].trim(),
						context: { start: from, lines: lines.slice(from - 1, b.line + 2) }
					},
					...(b.key ? { key: b.key } : {}),
					...(made_at ? { made_at } : {})
				});
			}
			const p = render_per_item_pattern(items, renders);
			if (p) patterns.push(p);
		}
		// THE CHANGE, WRITTEN, for a formatter built per call: its line, and the formatter built once
		if (source) {
			// per file: the names it already uses and what earlier rewrites added, so two sites never
			// add the same name for different formatters, and the same formatter is added once
			const files = new Map<string, FormatterRewriteOptions>();
			const opts_for = (path: string): FormatterRewriteOptions | undefined => {
				let o = files.get(path);
				if (o) return o;
				const all = source(path, 1, Number.MAX_SAFE_INTEGER)?.lines;
				if (!all) return undefined;
				const svelte = path.endsWith('.svelte');
				// `<script lang="ts">`, `lang='ts'`, `lang=ts`, `lang="typescript"`
				const tag = svelte
					? all.find((l) => l.includes('<script') && l.includes('lang='))
					: undefined;
				const ts =
					path.endsWith('.ts') ||
					path.endsWith('.mts') ||
					path.endsWith('.cts') ||
					(!!tag &&
						(tag.includes('ts"') ||
							tag.includes("ts'") ||
							tag.includes('=ts') ||
							tag.includes('typescript')));
				const taken = new Set<string>();
				for (const l of all) for (const t of tokens(l)) taken.add(t);
				o = { ts, svelte, taken, made: new Map() };
				files.set(path, o);
				return o;
			};
			for (const p of patterns) {
				if (p.kind !== 'formatter-per-call') continue;
				for (const site of p.sites) {
					if (site.rewrite) continue;
					const full = source(site.path, site.line, site.line)?.lines[0];
					const opts = opts_for(site.path);
					if (!full || !opts) continue;
					const rw = formatter_rewrite(full, opts);
					if (rw) {
						site.rewrite = { file: site.file, line: site.line, ...rw };
						continue;
					}
					// built on a line above and used here (`const rtf = new Intl…` then `rtf.format(…)`):
					// the building line is the one to change — when the name it makes is used on this line
					const above = source(site.path, Math.max(1, site.line - 3), site.line - 1);
					if (!above) continue;
					const used = tokens(full);
					for (let k = above.lines.length - 1; k >= 0; k--) {
						const l = above.lines[k];
						if (!l.includes('new Intl.')) continue;
						const name = line_rw(l).declared[0];
						if (
							!name ||
							!used.some((t, i) => t === name && used[i + 1] === '.' && used[i - 1] !== '.')
						)
							continue;
						const r2 = formatter_rewrite(l, opts);
						if (r2) site.rewrite = { file: site.file, line: above.start + k, ...r2 };
						break;
					}
				}
			}
		}
		// ANOTHER PAGE'S LINES: a visitor of another page overlapping every render (constant traffic,
		// so no render ran clean to keep) brings its own load's lines into the window — its waits, its
		// allocations, its CPU after an await (no frame of its page file left to set it aside by). A
		// pattern whose every site is in another route's page or layout file is not this page's
		const route = own_requests(s.meta).find((r) => r.route)?.route ?? s.meta.request?.route;
		if (route)
			for (let i = patterns.length - 1; i >= 0; i--) {
				const sites = patterns[i].sites;
				if (sites.length && sites.every((x) => another_routes_file(route, x.path || x.file)))
					patterns.splice(i, 1);
			}
		// SYNC I/O TOO QUICK TO SAMPLE: a *Sync call V8 counted in the render, found in the route's
		// own files (its page, the layouts above it, the hooks) — when the samples saw none
		if (route && s.call_counts && !patterns.some((p) => p.kind === 'sync-io')) {
			try {
				const read = await this.#source_reader();
				const { join } = await import('node:path');
				const dirs = route_folders(route);
				const rels: string[] = [];
				const add = (dir: string, names: string[]) => {
					for (const n of names)
						for (const ext of ['.ts', '.js']) rels.push(`routes/${dir ? `${dir}/` : ''}${n}${ext}`);
				};
				for (const d of dirs.above('src')) add(d, ['+layout.server', '+layout']);
				add(dirs.own('src'), ['+page.server', '+page']);
				for (const ext of ['.ts', '.js']) rels.push(`hooks.server${ext}`);
				const files: { path: string; file: string; text: string }[] = [];
				for (const rel of rels) {
					const text = read(rel);
					if (text) files.push({ path: join(process.cwd(), 'src', rel), file: rel, text });
				}
				// …and the app modules they import, one step (a `$lib` helper that reads a file per
				// request is the common case): each found once, at most 30
				const own = new Set(files.map((f) => f.file));
				for (const f of files.slice()) {
					for (const rel of module_imports(f.file, f.text)) {
						if (own.size >= 30 + rels.length) break;
						if (own.has(rel)) continue;
						const text = read(rel);
						if (!text) continue;
						own.add(rel);
						files.push({ path: join(process.cwd(), 'src', rel), file: rel, text });
					}
				}
				const p = counted_sync_io(s.call_counts, files);
				if (p) patterns.push(p);
			} catch {
				// ok: no file system: nothing to read the route's files from
			}
		}
		// biggest saving first — except a severe leak (8 MB+ kept per render), which leads: it ends
		// in an out-of-memory crash, not a slow page
		const severe = (p: Pattern) =>
			(p.kept_bytes ?? 0) >= 8 * 1024 * 1024 && p.growth !== 'levels-off';
		// per render on both sides: a CPU saving adds up every profiled render, a wait is one's
		const per_render = (p: Pattern) => (p.wait ? p.save_ms : p.save_ms / renders);
		patterns.sort((a, b) => Number(severe(b)) - Number(severe(a)) || per_render(b) - per_render(a));
		if (patterns.length) s.patterns = patterns;
		// A BUILD WITHOUT SOURCEMAPS: every line of a built chunk named by the source module it came
		// from (the build's module map), so `chunks/format.js:131` reads as src/lib/format.ts
		// (the ledger's lines were named right after it was built: the patterns read them)
		const label = (x: { path: string; line: number; module?: string }) => this.#label_module(x);
		for (const p of s.patterns ?? [])
			for (const site of p.sites) {
				label(site);
				for (const v of site.via ?? []) label(v);
			}
		// one render's time, drilled to the line (the ledger gives your functions' line shares)
		const tl_drill = s.analysis.timeline;
		if (tl_drill) {
			const renders_of = new Map<string, number>();
			for (const c of s.analysis.components) if (c.calls) renders_of.set(c.name, c.calls);
			const cold_owners = new Map((s.meta.cold?.owners ?? []).map((o) => [o.label, o.ms]));
			const drill = build_drill(
				tl_drill,
				ledger,
				patterns,
				s.gc_attr?.makers ?? [],
				renders_of,
				s.analysis.owner_runs_ms ?? {},
				cold_owners,
				wait_runs ?? {}
			);
			// each line row's code: a later compare tells a line an edit above renumbered (the same
			// code) from one fixed while another nearby got slower
			if (drill && source) {
				const with_code = (n: DrillNode) => {
					for (const c of n.children ?? []) {
						const fl = c.kind === 'line' && c.at ? at_line(c.at) : undefined;
						const code = fl ? source(fl.file, fl.line, fl.line)?.lines[0]?.trim() : undefined;
						if (code) c.code = code.slice(0, 120);
						with_code(c);
					}
				};
				with_code(drill);
			}
			if (drill && s.lineage?.sources) {
				// read or not is about the page.data slot: one verdict per key name
				const verdict = new Map(s.lineage.keys.map((k) => [k.key, k.verdict]));
				tag_fills(
					drill,
					s.lineage.sources.map((x) => ({ ...x, verdict: verdict.get(x.key) ?? 'unknown' }))
				);
				// DATA ONLY A LATE ISLAND NEEDS: the page's markup uses a key only as a late island's
				// prop, and the drill knows the waits that fill only such keys
				const read = await this.#source_reader();
				const late = new Map<
					string,
					{ island: string; wake: string; file: string; line: number; code: string }
				>();
				for (const c of s.lineage.components) {
					if (c.island || !c.file.endsWith('.svelte')) continue;
					const src = read(c.file);
					if (!src) continue;
					const lines = src.split('\n');
					for (const k of late_island_keys(src)) {
						// no OTHER file reads it (a layout, a sibling, a child handed the whole object):
						// moving the call into the island would leave those without it
						const elsewhere = s.lineage.components.some(
							(o) => o.file !== c.file && (o.whole || (o.reads ?? []).includes(k.key))
						);
						if (!elsewhere)
							late.set(k.key, {
								island: k.island,
								wake: k.wake,
								file: c.file,
								line: k.line,
								code: lines[k.line - 1]?.trim() ?? ''
							});
					}
				}
				if (late.size) {
					const items: LateIslandWait[] = [];
					const rows: DrillNode[] = [];
					const walk = (n: DrillNode) => {
						if (n.kind === 'wait' && n.fills?.length && n.fills.every((f) => late.has(f.key)))
							rows.push(n);
						for (const c of n.children ?? []) walk(c);
					};
					walk(drill);
					for (const r of rows) {
						const line = r.children?.find((c) => c.kind === 'line');
						const at = line?.children?.find((c) => c.kind === 'line')?.at ?? line?.at;
						if (!at) continue;
						const colon = at.lastIndexOf(':');
						const file = at.slice(0, colon);
						const n = Number(at.slice(colon + 1));
						const k = late.get(r.fills![0].key)!;
						items.push({
							call: r.label,
							ms: r.ms,
							alone: r.alone ?? 0,
							at: { path: file, file, line: n, code: read(file)?.split('\n')[n - 1]?.trim() ?? '' },
							key: r.fills![0].key,
							island: k.island,
							wake: k.wake,
							use: { path: k.file, file: k.file, line: k.line, code: k.code }
						});
						r.why = [...(r.why ?? []), 'late-island-wait'];
					}
					const p = late_island_pattern(items);
					if (p) {
						const list = (s.patterns ??= []);
						list.push(p);
						list.sort(
							(a, b) => Number(severe(b)) - Number(severe(a)) || per_render(b) - per_render(a)
						);
					}
				}
			}
			if (drill) s.drill = drill;
		}
		// after every fix named: one render, estimated without counting a saving twice (forecast.ts)
		if (s.meta.trigger === 'page' && (s.meta.run_status ?? 200) === 200) {
			const by_key = new Map(s.analysis.functions.map((fn) => [fn.key, fn]));
			const f = forecast_of(s.meta.runs, s.patterns, s.drill, {
				wait_cap: s.analysis.timeline?.wait_ms,
				cpu_cap: s.analysis.timeline?.cpu_ms,
				stacks: (k) => by_key.get(k)?.stacks,
				...(s.meta.answers?.runs_ms.length ? { answers_runs: s.meta.answers.runs_ms } : {}),
				cpu_main:
					s.analysis.functions
						.filter((fn) => MAIN_THREAD_CPU.has(fn.category))
						.reduce((t, fn) => t + fn.self_ms, 0) / Math.max(1, s.meta.runs?.length ?? 1)
			});
			// without sourcemaps fewer lines are seen, so fewer fixes: the forecast is a ceiling
			// (lines matched to the source by text count as seen)
			if (f)
				s.forecast =
					s.analysis.sourcemapped || s.analysis.text_mapped ? f : { ...f, partial: true };
		}
	}

	/** A reader of app sources at report time (a file relative to `src/` or the cwd, or absolute);
	 *  undefined where there is no file system, or when the file is not on this machine. */
	/** THE DEV SERVER: which page.data keys an island's code reads, from the plugin's run of the build's
	 *  analysis (vite/dev-maps.ts), by the region id in its entry (`…/ogygia:region/entry/<id>.js`).
	 *  Undefined off the dev server or when the plugin cannot say */
	async #dev_island_keys(entry: string): Promise<DevIslandKeys | undefined> {
		if (!this.dev) return undefined;
		const ask = (globalThis as Record<symbol, unknown>)[
			Symbol.for('ogygia.profiler.dev-page-keys')
		] as ((iid: string) => Promise<DevIslandKeys | undefined>) | undefined;
		const at = entry.indexOf(REGION_ENTRY_ID);
		if (!ask || at === -1) return undefined;
		const rest = entry.slice(at + REGION_ENTRY_ID.length);
		const dot = rest.indexOf('.');
		try {
			return await ask(dot === -1 ? rest : rest.slice(0, dot));
		} catch {
			return undefined;
		}
	}

	async #source_reader(): Promise<(file: string) => string | undefined> {
		let fs: typeof import('node:fs') | undefined;
		let path: typeof import('node:path') | undefined;
		try {
			fs = await import('node:fs');
			path = await import('node:path');
		} catch {
			fs = undefined;
		}
		const cache = new Map<string, string | undefined>();
		return (file: string): string | undefined => {
			if (!fs || !path) return undefined;
			if (cache.has(file)) return cache.get(file);
			const candidates = file.startsWith('/')
				? [file]
				: [path.join(process.cwd(), 'src', file), path.join(process.cwd(), file)];
			let out: string | undefined;
			for (const c of candidates) {
				try {
					out = fs.readFileSync(c, 'utf8');
					break;
				} catch {
					// ok: not this candidate; the next is tried
				}
			}
			// a deployed host has no src/: the text the build's maps carry (embedded-maps.ts)
			out ??= embedded_source(file);
			cache.set(file, out);
			return out;
		};
	}

	/** DATA LINEAGE FROM THE CODE (lineage.ts): the route's page and layouts, every component the
	 *  profile saw with a `.svelte` source on this machine, and the islands (their keys from the
	 *  build), each with the page.data keys it reads — joined to the loads' keys and the seed. */
	/** every `.svelte` under the app's `src/`, relative to it, listed once (null: no src here) */
	readonly #svelte_files = flights({
		name: 'profiler svelte files',
		run: async (): Promise<string[] | null> => {
			try {
				const fs = await import('node:fs');
				const path = await import('node:path');
				const root = path.join(process.cwd(), 'src');
				const out: string[] = [];
				for (const e of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
					if (!e.isFile() || !e.name.endsWith('.svelte')) continue;
					const rel = path
						.relative(root, path.join(e.parentPath, e.name))
						.split(path.sep)
						.join('/');
					if (!rel.includes('node_modules/')) out.push(rel);
				}
				return out;
			} catch {
				// a deployed host has no src/: the components the build's maps carry the source of
				const carried = embedded_files().filter((f) => f.endsWith('.svelte'));
				return carried.length ? carried : null;
			}
		}
	});
	/** The `src/`-relative paths of `<name>.svelte` files (a component is named after its file). */
	async #component_files(name: string): Promise<string[]> {
		// (nothing drops the list, so it is never STALE)
		const all = await this.#svelte_files.get();
		if (all === STALE) return [];
		const leaf = `/${name}.svelte`;
		return all ? all.filter((f) => f === `${name}.svelte` || f.endsWith(leaf)) : [];
	}

	async #lineage_for(stored: StoredReport, body: string): Promise<Lineage | undefined> {
		const a = stored.analysis;
		const tl = a.timeline;
		const read = await this.#source_reader();
		const lanes = tl?.lanes ?? [];
		const lane_files = [...new Set(lanes.map((l) => l.file))];
		// the parent() chain, read from the page load: what it waited on the layout for, and when it
		// first used it
		if (tl?.chain) {
			const src = read(tl.chain.page);
			const use = src ? parent_use(src) : null;
			if (use) tl.chain.parent_use = use;
		}
		// the waiting behind each lane: its calls in the whole recording, per render
		const runs = Math.max(stored.meta.runs?.length ?? 1, 1);
		const wait_by_lane = new Map<string, number>();
		for (const c of stored.net) {
			const text = [c.caller_site?.file ?? '', ...(c.callers ?? []), c.caller ?? ''].join(' ');
			const lane = load_lane_of(text)?.file;
			if (!lane) continue;
			const file = lane_files.includes(lane)
				? lane
				: lane_files.find((f) => f.endsWith(lane) || lane.endsWith(f));
			if (!file) continue;
			wait_by_lane.set(
				file,
				(wait_by_lane.get(file) ?? 0) + (Math.max(c.ms, 0) + (c.body_ms ?? 0)) / runs
			);
		}
		const lineage_lanes = lane_files.map((file) => {
			const src = read(file);
			return {
				file,
				keys: src ? load_return_keys(src) : null,
				...(wait_by_lane.has(file) ? { wait_ms: round2(wait_by_lane.get(file)!) } : {})
			};
		});
		// the files to scan: the route's page + layouts (from the lanes' folders, up to `routes/`),
		// then every component the profile saw with a readable `.svelte` source
		const files = new Map<string, { name: string; island: boolean }>();
		const route_dirs = new Set<string>();
		for (const f of lane_files) {
			const at = f.lastIndexOf('/');
			if (at === -1) continue;
			let dir = f.slice(0, at);
			while (dir) {
				route_dirs.add(dir);
				const up = dir.lastIndexOf('/');
				if (up === -1 || dir === 'routes') break;
				dir = dir.slice(0, up);
			}
		}
		for (const dir of route_dirs) {
			for (const leaf of ['+page.svelte', '+layout.svelte']) {
				const file = `${dir}/${leaf}`;
				if (read(file) !== undefined && !files.has(file))
					files.set(file, {
						name: `${dir.slice(dir.lastIndexOf('/') + 1)}/${leaf}`,
						island: false
					});
			}
		}
		// one spelling per file: the profile says `src/lib/X.svelte`, the lanes `routes/x/+page.svelte`
		const norm = (f: string) => (f.startsWith('src/') ? f.slice(4) : f);
		for (const c of a.components) {
			if (!c.url.endsWith('.svelte')) continue;
			const file = norm(c.url);
			if (files.has(file)) continue;
			if (read(file) !== undefined) files.set(file, { name: c.name, island: false });
		}
		// the islands: what the page's own seed explainer recorded (the runtime's answer per key:
		// which islands read it, which read the page whole), else the build's map (null: the whole
		// object), else a scan of the entry
		const seed_stats = own_requests(stored.meta).find((r) => r.og?.seed)?.og?.seed;
		const seen_entries = new Set<string>();
		const islands: {
			name: string;
			file: string;
			island: true;
			reads: string[] | null;
			whole_line?: number;
		}[] = [];
		for (const r of island_rows_of(stored.meta)) {
			if (seen_entries.has(r.entry)) continue;
			seen_entries.add(r.entry);
			const name = island_name(r);
			let keys: string[] | null | undefined;
			// the dev server: the build's own analysis, asked of the plugin (its seed ships whole, so
			// the runtime's answer there is "everything" for every island)
			const dev = await this.#dev_island_keys(r.entry);
			if (dev) keys = dev.keys === 'all' ? ['*'] : (dev.keys ?? []);
			else if (seed_stats) {
				keys = seed_stats.keys.filter((k) => k.readers.includes(name)).map((k) => k.key);
				if (seed_stats.whole_by.includes(name)) keys.push('*');
			} else {
				try {
					keys = region_page_keys(r.entry);
				} catch {
					keys = undefined;
				}
				if (keys === undefined) {
					const src = read(r.entry);
					keys = src ? data_reads(src, data_prop_names(src)) : null;
				} else if (keys === null) keys = ['*'];
			}
			// where it takes the page whole, from its own source, for a line to point at. In a build
			// the entry is a chunk URL (`/_app/immutable/og-region.<hash>.js`); the profile knows the
			// component's `.svelte` file by name, so that is the source to read
			let file = norm(r.entry);
			let whole_line: number | undefined;
			if (keys?.includes('*') || keys === null) {
				// the profile names its file when the component was sampled; a tiny one may not be, so
				// the app's own `src/` is searched for `<Name>.svelte` too
				const comp = a.components.find((c) => c.name === name && c.url.endsWith('.svelte'));
				// two files can share a name (a `Button.svelte` per folder): the one the route's own page
				// or layouts import comes first
				const named = await this.#component_files(name);
				const wanted = route_imports(files.keys(), read, name);
				const candidates = [
					...(comp ? [norm(comp.url)] : []),
					...named.filter((f) => wanted.has(f)),
					...named.filter((f) => !wanted.has(f)),
					file
				];
				for (const f of candidates) {
					const src = read(f);
					const line = src ? whole_read_line(src, data_prop_names(src)) : null;
					if (line) {
						file = f;
						whole_line = line;
						break;
					}
				}
				// its own file reads nothing whole: the build said which module in its closure did (a
				// helper it imports, a shared component), with the line — that is the line to fix
				if (!whole_line) {
					const whys = [
						...(region_page_why(r.entry) ?? []),
						// (the dev server's answer names absolute files)
						...(dev?.why ?? []).map((w) => ({ ...w, file: app_relative(w.file) ?? w.file }))
					];
					for (const w of whys) {
						if (!w.line) continue;
						const f = norm(w.file);
						if (read(f)?.split('\n')[w.line - 1] === undefined) continue;
						file = f;
						whole_line = w.line;
						break;
					}
				}
			}
			islands.push({
				name,
				file,
				island: true,
				reads: keys,
				...(whole_line ? { whole_line } : {})
			});
			// an island's entry is not a server component to scan on its own
			files.delete(norm(r.entry));
		}
		const components = [...files.entries()].map(([file, info]) => {
			const src = read(file)!;
			return { name: info.name, file, island: false, reads: data_reads(src, data_prop_names(src)) };
		});
		if (!components.length && !islands.length) return undefined;
		const seed_text = page_seed(body);
		const seed = seed_text !== null ? seed_key_bytes(seed_text) : {};
		const lineage = build_lineage({
			components: [...components, ...islands],
			lanes: lineage_lanes,
			seed
		});
		// each load's keys and their source lines: what a wait on one of those lines was for. Every
		// load file, not only the one lineage credits a key to — a layout and its page can return
		// the same key, and Kit merges both into the one page.data slot the verdict is about
		if (lineage) {
			const sources: NonNullable<Lineage['sources']> = [];
			for (const file of lane_files) {
				const src = read(file);
				const m = src ? key_sources(src) : null;
				for (const [key, lines] of m ?? [])
					sources.push({ key, from: file, lines, names: names_on(src!, lines) });
			}
			if (sources.length) lineage.sources = sources;
		}
		return lineage;
	}

	/** One more render under a LIVE-objects sampler (no collected-objects flag), then a full
	 *  collection, then the profile: every sampled object still alive was allocated by that
	 *  render and kept by something — the leak, by allocation site. Its own session, after the
	 *  runs, so nothing here is charged to them; the sites are source-mapped like the makers. */
	/** `n` renders with a full collection after each: the used heap after every one — and, from a
	 *  live-objects sampler left on across all of them, what each LINE still holds at the end (a
	 *  leaking line holds about `n` renders' worth; a line filling a bounded cache, about one). */
	async #growth_check(
		render: () => Promise<void>,
		n: number,
		until = Infinity
	): Promise<HeapGrowth | undefined> {
		const { Session } = await import('node:inspector/promises');
		const session = new Session();
		session.connect();
		try {
			const settled = async () => {
				await session.post('HeapProfiler.collectGarbage');
				return process.memoryUsage().heapUsed;
			};
			const series: number[] = [await settled()];
			await session.post('HeapProfiler.enable');
			await session.post('HeapProfiler.startSampling', { samplingInterval: LIVE_SAMPLING_BYTES });
			// the live sample is read twice from the SAME sampler, halfway and at the end: a leaking
			// line doubles between them, a bounded cache that filled stays — and the objects sampled
			// by then are the same objects both times, so the noise of one sample cancels
			const half = Math.floor(n / 2);
			let half_head: HeapNode | undefined;
			let last = 0;
			for (let i = 0; i < n; i++) {
				// `until`: the time this check may use. Three renders are the least a verdict reads from
				// (and the halfway read, at most the third, is already in); past that, another render that
				// would end after `until` is not started
				if (i >= 3 && clock.mono() + last > until) break;
				const t = clock.mono();
				await render();
				series.push(await settled());
				// FLAT AFTER THREE: the verdict's line is 64 KB a render; well under half of it, with the
				// settled heaps within 256 KB of each other, more renders cannot make it grow — each one
				// is a render and a full collection (/inferno: 4 of its 9 s went here, for "it levels off")
				if (i + 1 === 3 && is_flat(series)) break;
				// …and A LEAK PAST DOUBT after three: no halfway read then (its comparison needs renders
				// on both sides of it), the end's sample names the lines
				if (i + 1 === 3 && is_clear_leak(series)) {
					half_head = undefined;
					break;
				}
				if (i + 1 === half)
					half_head = (
						(await session.post('HeapProfiler.getSamplingProfile')) as {
							profile?: { head?: HeapNode };
						}
					).profile?.head;
				last = clock.mono() - t;
			}
			const res = (await session.post('HeapProfiler.getSamplingProfile')) as {
				profile?: { head?: HeapNode };
			};
			await session.post('HeapProfiler.stopSampling');
			const g = heap_growth(series);
			if (!g) return undefined;
			const head = res.profile?.head;
			if (head) g.sites = (await this.#live_sites(head)).rows;
			if (head && half_head) {
				g.half_renders = half;
				g.half_sites = (await this.#live_sites(half_head)).rows;
			}
			return g;
		} finally {
			try {
				session.disconnect();
			} catch {
				// ok: already disconnected, which is what this was for
			}
		}
	}

	async #retention_pass(render: () => Promise<void>): Promise<Retained | undefined> {
		const { Session } = await import('node:inspector/promises');
		const session = new Session();
		session.connect();
		try {
			await session.post('HeapProfiler.enable');
			await session.post('HeapProfiler.startSampling', { samplingInterval: LIVE_SAMPLING_BYTES });
			const t = performance.now();
			await render();
			const render_ms = round2(performance.now() - t);
			await session.post('HeapProfiler.collectGarbage');
			const res = (await session.post('HeapProfiler.getSamplingProfile')) as {
				profile?: { head?: HeapNode };
			};
			await session.post('HeapProfiler.stopSampling');
			const head = res.profile?.head;
			if (!head) return undefined;
			const { total, rows } = await this.#live_sites(head);
			return { total_bytes: total, render_ms, sites: rows };
		} finally {
			try {
				session.disconnect();
			} catch {
				// ok: already disconnected, which is what this was for
			}
		}
	}

	/** A live-objects heap sample, after a full collection, as rows: one per allocation line (the
	 *  same builtin from several stacks is one site), each charged to its app line (`at`). */
	async #live_sites(head: HeapNode): Promise<{ total: number; rows: RetainedSite[] }> {
		{
			const dict: Record<string, AllocSite> = {};
			const sites = heap_sites(head, dict);
			const resolver = await this.#make_resolver();
			const short = (u: string) =>
				u
					.replace(/^file:\/\//, '')
					.split('/')
					.slice(-2)
					.join('/');
			const by_ident = new Map<string, RetainedSite>();
			let total = 0;
			for (const [key, bytes] of sites) {
				const d = dict[key];
				if (!d || d.category === 'profiler' || d.category === 'v8' || d.category === 'gc') continue;
				let url = d.url;
				let line = d.line;
				let caller = d.caller;
				let at: { path: string; line: number } | undefined;
				if (resolver) {
					const m = url ? resolver.resolve(url, line - 1, 0) : undefined;
					if (m) {
						url = m.source;
						line = m.line;
					}
					let caller_at: { path: string; line: number } | undefined;
					if (d.caller_url && d.caller_name) {
						const c = resolver.resolve(d.caller_url, (d.caller_line ?? 1) - 1, 0);
						if (c) {
							caller = `${d.caller_name} (${short(c.source)}:${c.line})`;
							caller_at = { path: c.source, line: c.line };
						}
					}
					const cat = m
						? categorize({
								functionName: d.name,
								url: m.source,
								lineNumber: m.line - 1,
								columnNumber: 0,
								scriptId: ''
							}).category
						: d.category;
					if ((cat === 'app' || cat === 'component') && m) at = { path: m.source, line: m.line };
					else at = caller_at;
					// a build without sourcemaps: the site (or its caller) at its line of the built chunk
					if (!at && !m)
						at = this.#chunk_at(d.url, d.line) ?? this.#chunk_at(d.caller_url, d.caller_line);
				}
				const ident = `${d.name}|${url}|${line}|${caller ?? ''}`;
				const row = by_ident.get(ident) ?? {
					name: d.name,
					url,
					line,
					...(caller ? { caller } : {}),
					...(at ? { at } : {}),
					component: d.component,
					bytes: 0,
					share: 0
				};
				row.bytes += bytes;
				by_ident.set(ident, row);
				total += bytes;
			}
			const rows = [...by_ident.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 30);
			for (const r of rows) r.share = total ? round2(r.bytes / total) : 0;
			return { total, rows };
		}
	}

	#compare(a: string | undefined, b: string | undefined) {
		const A = this.#reports.get(a ?? '');
		const B = this.#reports.get(b ?? '');
		// one (or both) gone from this server — restarted, or an ephemeral host: the compare page
		// then builds the comparison from the browser's own store
		if (!A || !B) return { base: this.base, cmp: null, a: a ?? '', b: b ?? '' };
		return {
			base: this.base,
			cmp: compare_reports(this.#pack(A), this.#pack(B)),
			a: A.meta.id,
			b: B.meta.id
		};
	}

	/** a stored report as the comparison reads it */
	#pack(s: StoredReport) {
		return {
			meta: s.meta,
			analysis: s.analysis,
			// the warnings only: an info line describes the page ("Most expensive component: …", a burst
			// of allocation) at a cut its numbers sit near, and came and went between profiles of the
			// same code (/mixed: alloc-burst and logic-heavy 3 of 5, /heavy: markup-heavy 2 of 5) — never
			// a problem "new" or "fixed"
			findings: derive_findings(s.analysis, s.meta, this.#report_extras(s))
				.filter((f) => f.severity === 'warn')
				.map((f) => `${f.code}: ${f.message}`),
			...(s.gc_attr ? { gc: s.gc_attr } : {}),
			...(s.patterns ? { patterns: s.patterns } : {}),
			...(s.ledger ? { ledger: s.ledger } : {}),
			...(s.drill ? { drill: s.drill } : {}),
			...(s.forecast ? { forecast: s.forecast } : {})
		};
	}

	/** DEV ONLY: nine lines of a local source file around `l` — the source peek an expanded row
	 *  shows. Behind the login like every route; the path must resolve inside the project (the
	 *  process cwd, symlinks followed) and be a source file. Anything else is a 404. */
	async #source(ctx: RouteCtx): Promise<Response> {
		if (!this.dev) return new Response('Not found', { status: 404 });
		const p = ctx.url.searchParams.get('p') ?? '';
		const line = Math.max(1, Number(ctx.url.searchParams.get('l')) || 1);
		// `to`: widen the peek to cover the hot lines (capped so a whole file never ships)
		const to = Math.min(line + 60, Math.max(line, Number(ctx.url.searchParams.get('to')) || line));
		try {
			const fs = await import('node:fs');
			const path = await import('node:path');
			const real = fs.realpathSync(p);
			const root = fs.realpathSync(process.cwd());
			if (!real.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
			if (!SOURCE_EXT_RE.test(real)) return new Response('Not found', { status: 404 });
			const lines = fs.readFileSync(real, 'utf8').split('\n');
			const start = Math.max(1, line - 4);
			const end = Math.min(lines.length, to + 4);
			return ctx.json({ path: real, start, line, lines: lines.slice(start - 1, end) });
		} catch {
			return new Response('Not found', { status: 404 });
		}
	}

	/** No open redirect: a `next` only bounces back into the profiler. It is read as the browser
	 *  reads it (a URL against this origin) and kept, as read, only on this origin and under the base,
	 *  at the root too (test/property-login-next.test.ts). */
	#safe_next(next: string | null): string {
		const fallback = this.base || '/';
		let u: URL;
		try {
			u = new URL(next ?? fallback, SAME_ORIGIN);
		} catch {
			return fallback; // ok: not a URL is no place to go back to
		}
		// (a path that reads `//host` once set as an address would leave the origin again)
		if (u.origin !== SAME_ORIGIN || u.pathname.startsWith('//')) return fallback;
		if (u.pathname !== this.base && !u.pathname.startsWith(`${this.base}/`) && this.base !== '')
			return fallback;
		return u.pathname + u.search;
	}

	/** Clear the session cookie and bounce to the dashboard. */
	async #logout(ctx: RouteCtx): Promise<Response> {
		await this.#revoke_sessions(ctx.event!);
		const res = ctx.redirect(this.base);
		// (one Set-Cookie: the beacon flag is cleared on the next response, #flag_cookie)
		res.headers.append('set-cookie', this.#session_cookie('', ctx.event!));
		return res;
	}

	#dashboard(by: string | null) {
		const tag_keys = new Set<string>();
		for (const e of this.#ring) for (const k of Object.keys(e.tags ?? {})) tag_keys.add(k);
		return {
			base: this.base,
			recent: this.#ring,
			routes: route_aggregates(this.#ring, by && tag_keys.has(by) ? by : null),
			by: by && tag_keys.has(by) ? by : null,
			tag_keys: [...tag_keys].sort(),
			reports: [...this.#reports.values()].map((r) => r.meta).reverse(),
			// each report's biggest fix, so the list says what to do before a report is opened
			top_fix: Object.fromEntries(
				[...this.#reports.values()]
					.filter((r) => r.patterns?.length)
					.map((r) => {
						const p = r.patterns![0];
						// per render, like the report says it (a CPU saving adds up every profiled render)
						const n = r.meta.trigger === 'page' ? r.meta.runs?.length || 1 : 1;
						return [
							r.meta.id,
							{
								title: p.title,
								save_ms: round2(p.wait ? p.save_ms : p.save_ms / n),
								wait: !!p.wait,
								more: r.patterns!.length - 1
							}
						];
					})
			),
			// the lines that slow two or more pages: fixed once, every one of them faster
			site_fixes: this.#site_fixes(),
			// holes across the server: their renders, their cache, and who held the render slots
			holes: hole_slots(this.#ring),
			recording: this.#recorder.held,
			dev: this.dev,
			rss_mb: Math.round(process.memoryUsage().rss / 1048576),
			inflight: this.#inflight,
			// each point with its page score, so the dashboard trend shows the score beside the render
			history: page_history(
				[...this.#reports.values()].map((r) => r.meta),
				(id) => {
					const s = this.#reports.get(id);
					if (!s || s.meta.trigger !== 'page') return undefined;
					try {
						return page_score_of(s.meta, this.#report_extras(s)).score;
					} catch {
						return undefined;
					}
				}
			),
			trap: this.#trap
				? {
						over: this.#trap.over,
						window_ms: this.#trap.window ?? 5000,
						caught: caught_of(this.#trap_loop),
						keep: this.#trap.keep ?? 3,
						state: trap_state(this.#trap_loop)
					}
				: null,
			sampled: this.#sampled_summary(),
			background_note: this.#background_notes()
		};
	}

	// The interactive run page: shows a progress bar, fires the profile at /page from an island, then
	// swaps to the report. Both the dashboard "Profile a page" form and the devtools Profiler tab point
	// here (the tab embeds it in an iframe), so the progress UX lives in one place.
	#run_page(ctx: RouteCtx) {
		const q = ctx.url.searchParams;
		// typed into a form: `docs/overview` means `/docs/overview` (never a URL of another site)
		let path = (q.get('p') ?? '').trim();
		if (path && !path.startsWith('/') && !path.includes('://')) path = `/${path}`;
		if (!path.startsWith('/') || path.startsWith('//')) {
			return error(400, 'Give a path on this site, like /docs/overview.');
		}
		const runs = clamp(Number(q.get('runs')) || 5, 1, 50);
		const format = q.get('format') === 'ogp' ? 'ogp' : '';
		// `against=<report id>`: when the run is done, open it compared with that report (a fix,
		// checked in one click); only a report id's own characters pass
		const against_raw = q.get('against') ?? '';
		let against = '';
		for (const ch of against_raw) {
			const c = ch.charCodeAt(0);
			if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 122))) {
				against = '';
				break;
			}
			against += ch;
		}
		return {
			base: this.base,
			path,
			runs,
			format,
			...(against && against.length <= 32 ? { against } : {})
		};
	}

	// A WINDOW YOU START AND STOP — the server side of a test's (or the devtools Record tab's) actions:
	// the CPU sampled across every request those actions made, their outbound calls, the requests
	// themselves. One at a time (it holds the recorder); capped so a forgotten stop cannot hold it.
	// Its state is `#win` (window_machine).

	// A WINDOW ACROSS INSTANCES (a serverless deployment: start, the session's requests and stop can
	// each land on another instance). Start answers an id, signed with the profiler's secret so any
	// instance can check it; the test's driver sends it on each of the session's requests (`x-og-window`);
	// every instance writes such a request to the shared store (its visit rows, under the window's own
	// key) BEFORE it answers — a frozen instance never finishes a write after; and stop, on whichever
	// instance, gathers them. The CPU profile stays the starting instance's: sampling is per process.
	// (the ids are a capability, ./window-id.ts: a production profiler with no secret has none)
	readonly #window_ids = flights({
		name: 'profiler window ids',
		run: () =>
			import('./window-id.ts').then((m) =>
				m.window_ids(this.secret, this.dev, `profiler:${this.base}`)
			)
	});
	async #ids(): Promise<WindowIds | null> {
		const ids = await this.#window_ids.get();
		// (never dropped, so never STALE; if it were, no ids: a window id is refused, never trusted)
		return ids === STALE ? null : ids;
	}

	/** A window id from a request, when it checks; else null. */
	async #window_id_of(request: Request): Promise<string | null> {
		const raw = request.headers.get(WINDOW_HEADER);
		if (!raw) return null;
		return (await this.#ids())?.check(raw) ?? null;
	}

	/** A request in a window: written to the store, awaited (see above). */
	async #window_note(entry: RequestEntry, request: Request): Promise<void> {
		if (!this.#store?.putVisit || entry.internal) return;
		const id = await this.#window_id_of(request);
		if (!id) return;
		const rec = {
			method: entry.method,
			path: entry.path,
			route: entry.route ?? null,
			ms: entry.ms,
			status: entry.status ?? null,
			cpu_ms: entry.cpu_ms,
			net_ms: entry.net_ms ?? null,
			net_count: entry.net_count ?? 0,
			at: Date.now(), // wall: stored, and read by other instances
			instance: this.#instance_id
		};
		const store = await this.#store_ready();
		if (!store?.putVisit) return;
		try {
			await store.putVisit({
				key: `${WINDOW_PAGE_PREFIX}${id}\0${rec.at}\0${Math.random().toString(36).slice(2, 8)}`,
				page: WINDOW_PAGE_PREFIX + id,
				at: rec.at,
				visit: JSON.stringify(rec)
			});
		} catch {
			// ok: the store is down: this request is missing from the window, and the window's own report write says the store failed
		}
	}

	/** The requests every instance wrote for a window. */
	async #window_requests(id: string): Promise<
		{
			method: string;
			path: string;
			route: string | null;
			ms: number;
			status: number | null;
			cpu_ms: number;
			net_ms: number | null;
			net_count: number;
			at: number;
			instance: string;
		}[]
	> {
		const store = await this.#store_ready();
		if (!store?.listVisits) return [];
		try {
			const rows = await store.listVisits(WINDOW_PAGE_PREFIX + id, MAX_VISITS_PER_KEY);
			return rows.map((r) => JSON.parse(r.visit)).sort((a, b) => a.at - b.at);
		} catch {
			return [];
		}
	}

	/** This instance, told apart from the others in a window's requests. */
	readonly #instance_id = Math.random().toString(36).slice(2, 10);

	async #window_start(ctx: RouteCtx): Promise<Response> {
		const busy = (message: string) => this.#busy(message);
		if (this.#win.now.kind !== 'idle') return busy('A window is already recording: stop it first.');
		// a BACKGROUND window (the trap, the always-on sampler) holding the recorder is short: wait
		// for it (as a page profile does); another page profile is the real conflict
		await this.#wait_for_background();
		const ids = await this.#ids();
		if (ids === null)
			return busy('A window needs the profiler’s secret: set OGYGIA_PROFILER_SECRET.');
		const id = ids.mint();
		// (a window started meanwhile holds the recorder: this take fails)
		const token = this.#take('background');
		if (token === null) return busy('Another recording holds the recorder. Try again in a moment.');
		this.#ensure_net?.();
		let stop!: () => void;
		const stopped = new Promise<void>((r) => (stop = r));
		const done = this.#capture_window(Math.min(this.sample_interval, 1000), () => stopped, {
			light: true
		});
		this.#win.go('recording', { id, token, done });
		const mine = this.#win.now;
		// leaving `recording` any way (a stop, the cap, a reset) ends the capture's work
		this.#win.scope.defer(stop);
		// the capture settled: a failed one ends the window; once one the cap (a stop that never came
		// here: a forgotten one, or one another instance answered) or a reset ended is done, the recorder
		// is free. A stop frees it itself, once its report is made.
		const settled = () => {
			if (this.#win.now === mine) this.#win.go('idle');
			const now = this.#win.now;
			if (now.kind !== 'stopping' || now.token !== token) this.#free(token);
		};
		done.then(settled, settled);
		// `shared`: the requests of other instances reach this window (a store with visit rows)
		return ctx.json({
			ok: true,
			id,
			header: WINDOW_HEADER,
			shared: !!(this.#store?.putVisit && this.#store.listVisits),
			max_ms: WINDOW_MAX_MS
		});
	}

	/** A page profile or a window waits (a few seconds at most) for a background window (the trap,
	 *  the sampler, a started window) to give the recorder back. The trap and the sampler do not
	 *  start again while one waits. The wait is its request's: once the request ends, it waits no
	 *  more. */
	async #wait_for_background(): Promise<void> {
		if (this.#holder.now.kind !== 'background') return;
		this.#page_waiting++;
		const wait = scope(current_request_scope() ?? undefined);
		try {
			// the recorder leaving `background` (the holder's next move), or the deadline: no poll
			wait.timeout(() => wait.close(), PAGE_WAITS_FOR_BACKGROUND_MS);
			await wait.task(() => this.#holder.wait('free'));
		} finally {
			wait.close();
			this.#page_waiting--;
		}
	}

	async #window_stop(ctx: RouteCtx): Promise<Response> {
		const asked = ctx.event ? await this.#window_id_of(ctx.event.request) : null;
		const w = this.#win.now;
		const ours = w.kind !== 'idle' && (!asked || w.id === asked);
		// a second stop (a retry) while the first makes the report: the same answer
		if (ours && w.kind === 'stopping') {
			const a = await w.answer;
			return ctx.json(a.body, { status: a.status });
		}
		if (!ours || w.kind !== 'recording') {
			// another instance started it: its requests from the store (every instance wrote them), and no
			// CPU profile — sampling ran in the starting instance
			if (asked && this.#store?.listVisits) {
				const reqs = await this.#window_requests(asked);
				const busy = round2(reqs.reduce((a, r) => a + (r.cpu_ms || 0), 0));
				return ctx.json({
					kind: 'window',
					id: null,
					target: { page: '', runs: [] },
					score: null,
					forecast: null,
					findings: [],
					assets: null,
					links: { html: '', json: '' },
					summary: { busy_ms: busy },
					cpu: 'the instance that started the window sampled it; this one only gathered the requests',
					window: {
						ms: reqs.length ? reqs[reqs.length - 1].at - reqs[0].at : 0,
						requests: reqs,
						instances: new Set(reqs.map((r) => r.instance)).size
					}
				});
			}
			return ctx.json(
				{ error: 'No window is recording (start one with POST /window/start).' },
				{ status: 400 }
			);
		}
		// (leaving `recording` ends the capture's work: the answer waits for the capture to finish)
		const answer = this.#window_answer(w);
		this.#win.move('recording', 'stopping', { id: w.id, token: w.token, answer });
		const a = await answer;
		return ctx.json(a.body, { status: a.status });
	}

	/** The stopped window's report, made once; the window holds the recorder until it is made. */
	async #window_answer(w: {
		id: string;
		token: LockToken;
		done: Promise<WindowCapture>;
	}): Promise<WindowAnswer> {
		try {
			return await this.#window_report(w.id, await w.done);
		} catch (e) {
			return {
				status: 500,
				body: { error: `The window failed: ${e instanceof Error ? e.message : String(e)}` }
			};
		} finally {
			const now = this.#win.now;
			if (now.kind === 'stopping' && now.token === w.token) this.#win.go('idle');
			this.#free(w.token);
		}
	}

	async #window_report(window_id: string, cap: WindowCapture): Promise<WindowAnswer> {
		// the requests the window saw (not the profiler's own)
		const own = `${this.base}/`;
		// this instance's requests over the window (all of them: the server-side calls a tagged request
		// made carry no tag), and the other instances' tagged ones from the store
		const shared = await this.#window_requests(window_id);
		const others = shared.filter(
			(e) => e.instance !== this.#instance_id && !e.path.startsWith(own) && e.path !== this.base
		);
		const requests = [
			...this.#ring
				.filter(
					(e) =>
						!e.internal &&
						e.ts >= cap.t0 &&
						e.ts <= cap.t1 &&
						!e.path.startsWith(own) &&
						e.path !== this.base
				)
				.map((e) => ({
					method: e.method,
					path: e.path,
					route: e.route ?? null,
					ms: round2(e.ms),
					status: e.status ?? null,
					cpu_ms: e.cpu_ms,
					instance: this.#instance_id
				})),
			...others
		];
		const id = await this.#finish_report(cap, {
			trigger: 'window',
			...(requests[0]
				? {
						request: {
							method: requests[0].method,
							path: requests[0].path,
							route: requests[0].route,
							ms: requests[0].ms
						}
					}
				: {})
		});
		const s = this.#reports.get(id)!;
		return {
			status: 200,
			body: {
				...report_json(s.analysis, s.meta, this.base, this.#report_extras(s)),
				window: {
					ms: round2(cap.t1 - cap.t0),
					requests,
					...(shared.length ? { instances: new Set(requests.map((r) => r.instance)).size } : {})
				}
			}
		};
	}

	// Manually clear a wedged recording flag (belt-and-suspenders with the time-based auto-heal).
	// The dashboard's Reset: the escape hatch for a wedged recording. Clears the site-wide attribution tax
	// AND frees the recorder lock so a new profile can start on this worker. Whoever held it loses it:
	// its token stops working, so its late cleanup frees and switches off nothing of the next owner's.
	// A window recording ends with it.
	#reset(ctx: RouteCtx): Response {
		if (this.#holder.now.kind !== 'free') {
			this.#recorder.free(this.#recorder.seize());
			this.#holder.go('free');
		}
		if (this.#win.now.kind !== 'idle') this.#win.go('idle');
		this.#release_als();
		return ctx.redirect(this.base);
	}

	// The page-profile recording: warm-up + redirect-resolve, a serverless-budgeted run loop, and the
	// always-on coverage pass. Redirects to the report (or ?format=json / ?format=ogp).
	async #record_page(
		ctx: RouteCtx,
		replay?: { path: string; headers: Record<string, string> }
	): Promise<Response> {
		const event = ctx.event!; // event.fetch (Kit's internal SSR render) is the one thing only Kit gives
		// One recording per worker (shared inspector). A BACKGROUND window (the trap, the sampler)
		// holding it yields: it is short, and it will not re-arm while a page profile waits — so wait
		// for it here (a few seconds at most) rather than bounce. Another PAGE recording is the real
		// conflict: refuse immediately with a 409 the client retries — don't hold a waiter in memory
		// (unreliable on a worker that may be recycled within 30 s). The retry lands on a free worker
		// (serverless) or comes back once this one finishes (single server). Reset clears a wedged one.
		await this.#wait_for_background();
		const token = this.#take('recording');
		if (token === null)
			return this.#busy(
				'A profile is already running on this worker. Waiting for it to finish (or for a free worker).'
			);
		const q = ctx.url.searchParams;
		// (a wedged run, whose page or upstream call hangs so this method never reaches its `finally`,
		// is cut at the hard cap: the site stops paying the attribution tax then, not at
		// RECORDING_MAX_MS; recorder_machine's own time)
		// THIS RECORDING'S OWN kept answers: another recording ending never drops them
		const kept_owner = {};
		// Re-assert the fetch patch right before profiling — `globalThis.fetch` may have been replaced
		// since install, which is why runs sometimes missed network. Self-heals to reliable capture.
		this.#ensure_net?.();
		try {
			const path = replay?.path ?? q.get('p') ?? '';
			if (!path.startsWith('/') || path.startsWith('//')) {
				return error(400, 'Give a path on this site, like /docs/overview.');
			}
			const runs = clamp(Number(q.get('runs')) || 5, 1, 50);
			const interval = clamp(Number(q.get('interval')) || 200, 50, 10_000);
			// THE HEAP ALREADY NEARLY FULL (a page that keeps what it renders, profiled before): the
			// warm-up alone could end the process. Say so instead of starting
			// (read inside a try — off Node there is no node:v8 — and refused outside it: `error` throws)
			let heap_now: { used_heap_size: number; heap_size_limit: number } | null = null;
			try {
				heap_now = (await import('node:v8')).getHeapStatistics();
			} catch {
				heap_now = null;
			}
			if (
				heap_now &&
				heap_now.heap_size_limit > 0 &&
				heap_now.used_heap_size / heap_now.heap_size_limit >= HEAP_START
			)
				return error(
					503,
					`The server's heap is ${Math.round((heap_now.used_heap_size / heap_now.heap_size_limit) * 100)}% full (${Math.round(heap_now.used_heap_size / 1048576)} of ${Math.round(heap_now.heap_size_limit / 1048576)} MB): profiling now could run it out of memory and end the process. Something keeps what each render makes (the last profile's Kept per render names the line). Restart the server, then profile once.`
				);
			// The whole /page request has to return before the platform's gateway kills it (Amplify 30s,
			// Netlify 10s, Vercel 300s, …). Start the budget clock now — warm-up, CPU runs, AND the
			// coverage pass all live inside it. Infinity on a real server.
			const work_budget = serverless_work_budget_ms();
			// the requests this instance served BEFORE this recording (its own renders and their calls
			// go through the handle too, and are not "before")
			const requests_before = Math.max(0, this.#requests_seen - 1);
			// Cap the run at the hard limit even on a real server (Infinity budget): a page recording must
			// never outlive RECORDING_HARD_CAP_MS, because it holds the site-wide attribution context open.
			const budget_deadline = Number.isFinite(work_budget) ? clock.mono() + work_budget : Infinity;
			// when the platform itself cuts the request (Amplify: 30 s from now): the store write at the
			// end may only wait for what is left of it
			const request_deadline = clock.mono() + detect_request_budget_ms();
			const deadline = Math.min(budget_deadline, clock.mono() + RECORDING_HARD_CAP_MS);
			// Each render is raced against a timeout so a single hung upstream can't pin the recording (and
			// the site) — the smaller of PER_RENDER_TIMEOUT_MS and whatever budget is left.
			const fetch_render = (p: string, extra?: Record<string, string>) => {
				// a reset took the recorder: this run renders nothing more under the next owner
				if (!this.#holds(token))
					return Promise.reject(new Error('the recording was reset before it finished'));
				const left = deadline - clock.mono();
				const ms = Number.isFinite(left)
					? Math.max(1, Math.min(PER_RENDER_TIMEOUT_MS, left))
					: PER_RENDER_TIMEOUT_MS;
				return with_timeout(
					event.fetch(p, {
						// AS A BROWSER LOADS IT: a page navigation. A load's streamed promises stream only to a
						// navigation (the document ships, then a script per settle); any other fetch gets them
						// settled on the server first — another render than a visitor's, and one chunk, so the
						// byte strip never showed what held the document open
						headers: {
							'sec-fetch-mode': 'navigate',
							'sec-fetch-dest': 'document',
							accept: 'text/html',
							...replay?.headers,
							...extra,
							'x-og-profiler-internal': '1'
						}
					}),
					ms,
					'render timed out (the page or one of its upstream calls did not return in time)'
				);
			};

			// Warm-up + redirect resolve. `/fr/fr` may 308 → `/fr/fr/` (trailing slash), or i18n-redirect;
			// profiling the 3xx measures nothing (the classic "3 ms window, no components" report). Follow
			// the chain HERE, once, un-profiled (it also pays the cold module-load cost), and profile the
			// FINAL url. The warm-up's own wall time is reported so a caching app is obvious.
			let target = path;
			let redirected_from: string | undefined;
			/** a hop was a prerendered redirect's stub (a meta refresh answered 200) */
			let redirect_stub = false;
			let warmup_ms: number | undefined;
			let warm_status = 0;
			let warm_bytes = 0;
			// THE COLD START: the first warm-up render pays module load + compile — profiled on its own
			// (a light window: sampler only) so the report can show what that first render cost per
			// file against the warm renders. `?cold=0` skips it.
			let cold_cap: WindowCapture | undefined;
			const want_cold = q.get('cold') !== '0';
			mem_mark('before the warm-up render');
			for (let hop = 0; hop < 5; hop++) {
				let t = performance.now();
				let res: Response | undefined;
				let body = '';
				try {
					if (hop === 0 && want_cold) {
						// (timed INSIDE the window: the recorder's own start and stop — the inspector
						// session, the sampler, reading the profile — took ~400 ms, and every page read as
						// a 400 ms cold start against a 1 ms warm render)
						let t1 = 0;
						cold_cap = await this.#capture_window(
							interval,
							async () => {
								t = performance.now();
								res = await fetch_render(target);
								body = await res.text();
								t1 = performance.now();
							},
							{ light: true }
						);
						if (res) warmup_ms = round2(t1 - t);
					} else {
						res = await fetch_render(target);
						body = await res.text();
						warmup_ms = round2(performance.now() - t);
					}
				} catch {
					break; // warm-up failure surfaces on the real runs below
				}
				if (!res) break;
				warm_status = res.status;
				warm_bytes = body.length;
				// fetch may follow same-origin redirects itself (res.redirected) or hand back the 3xx
				// (…or a prerendered redirect: a 200 stub with a meta refresh, the build's stand-in for one)
				const stub = res.ok && !res.redirected ? refresh_target(body, event.url.origin) : null;
				const next = res.redirected
					? new URL(res.url).pathname + new URL(res.url).search
					: res.status >= 300 && res.status < 400
						? (() => {
								const loc = res.headers.get('location');
								if (!loc) return null;
								const u = new URL(loc, event.url.origin);
								return u.pathname + u.search;
							})()
						: stub;
				if (!next || next === target) break;
				redirected_from ??= path;
				if (stub && next === stub) redirect_stub = true;
				target = next;
			}

			const run_ms: number[] = [];
			const run_windows: Array<{ start: number; end: number }> = [];
			let run_status = warm_status;
			let run_cache_control: string | undefined;
			let run_sets_cookie = false;
			let run_bytes = warm_bytes;
			let last_body = '';
			/** the first render's document, set against the last: what changes between renders */
			let first_body = '';
			const body_prints: string[] = [];
			let last_chunks: { end: number; t: number }[] = [];
			let budget_note: string | undefined;
			// Reserve room for the coverage pass (call counts — "traverse ×768k") so a slow page can never
			// consume the whole budget on CPU runs and starve it. One render is priced at the SLOWEST seen so
			// far (the warm-up, then each run): a page that keeps what it renders gets slower run by run, and
			// pricing it at the first render overran the budget. Coverage turns V8's inlining off, so that
			// render runs about one and a half to two times a warm one, and turning coverage on walks every
			// compiled function first — about one more render again: the pass is 3 to 3.5 slowest renders on
			// a fast machine (measured on /hell), and a slow CI runner overran 3 by two seconds.
			let slowest = warmup_ms ?? 0;
			const coverage_reserve = () => Math.max(slowest * 4.5, 300);
			// `?gc=0`: record without the GC attribution (no allocation-stream sampling, no reads) — the
			// cheaper recording, and the control for what the attribution costs
			const gc_attr = q.get('gc') !== '0';
			// the retention render: its render plus the full collection after it
			const retention_reserve = () => (gc_attr && this.want_heap ? slowest * 1.5 + 500 : 0);
			// THE HEAP'S ROOM: a page that keeps what it renders (a leak) fills the heap render by render,
			// and the profiler renders it many times — past the limit the process dies, the profile with
			// it (/hell, profiled again and again: out of memory at 3.9 GB in the heap profiler's read).
			// The timed renders stop at HEAP_STOP of the limit, the extra renders (what a render keeps,
			// the growth check) are skipped past HEAP_EXTRAS; the report says what was left out
			let v8_stats: (() => { used_heap_size: number; heap_size_limit: number }) | null = null;
			try {
				v8_stats = (await import('node:v8')).getHeapStatistics;
			} catch {
				v8_stats = null;
			}
			const heap_fill = () => {
				const s = v8_stats?.();
				return s && s.heap_size_limit > 0 ? s.used_heap_size / s.heap_size_limit : 0;
			};
			const heap_skipped: string[] = [];
			const heap_guard = () => {
				const s = v8_stats?.();
				return s
					? {
							used_mb: Math.round(s.used_heap_size / 1048576),
							limit_mb: Math.round(s.heap_size_limit / 1048576),
							skipped: heap_skipped
						}
					: undefined;
			};
			// the timed renders keep what each GET answered: the keep-the-answers renders are served it
			this.#kept?.keep(kept_owner, true);
			mem_mark('before the timed renders');
			const cap = await this.#capture_window(
				interval,
				async () => {
					// a render another visitor of this same page overlapped (left out afterwards): when too
					// few ran clean, a few more are made — up to twice the runs asked for, inside the budget
					const path_only = target.split('?')[0];
					const mixed = (w: { start: number; end: number }) =>
						this.#ring.some(
							(e) =>
								!e.internal &&
								e.pt !== undefined &&
								e.path === path_only &&
								e.pt < w.end &&
								(e.ms > 0 ? e.pt + e.ms : Infinity) > w.start
						);
					const want_clean = Math.min(2, runs);
					for (let i = 0; i < runs * 2; i++) {
						if (i >= runs && run_windows.filter((w) => !mixed(w)).length >= want_clean) break;
						// (the heap nearly full: one render more could take the process down)
						if (i > 0 && heap_fill() >= HEAP_STOP) {
							if (i < runs) {
								budget_note = `Ran ${i} of ${runs} renders — stopped: the server's heap was ${Math.round(heap_fill() * 100)}% full, and each render of this page keeps more of it.`;
								heap_skipped.push(`${runs - i} of the timed renders`);
							}
							break;
						}
						// Stop early if another CPU run + the reserved coverage pass wouldn't finish in time.
						// The retention render is kept room for too: on a trimmed run, one CPU render fewer
						// costs little, and what a render leaves behind is the finding that matters most.
						if (
							i > 0 &&
							clock.mono() + slowest + retention_reserve() + coverage_reserve() > deadline
						) {
							// which limit it was: the platform's (serverless) or the recording's own cap (any
							// server: a recording holds the site-wide attribution open, so it never runs longer)
							const serverless = Number.isFinite(budget_deadline) && deadline === budget_deadline;
							const limit_ms = serverless ? work_budget : RECORDING_HARD_CAP_MS;
							const budget_label =
								limit_ms >= 1000
									? `${Math.round(limit_ms / 1000)} s`
									: `${Math.round(limit_ms)} ms`;
							// (an extra render for a clean one is not a render asked for: no note)
							if (i < runs)
								budget_note = `Ran ${i} of ${runs} renders — trimmed to fit the ${
									serverless
										? `${budget_label} serverless budget`
										: `${budget_label} limit on one recording`
								} (the page renders in ~${Math.round(warmup_ms ?? 0)} ms). Fewer runs, same accuracy per run.`;
							break;
						}
						const t = performance.now();
						let res: Response;
						try {
							res = await fetch_render(target);
						} catch {
							// A render timed out (hung page/upstream). Stop the loop and finish with the runs we
							// already have rather than failing the whole recording — and let the outer finally
							// clear the recording state so the site is not held hostage to this page.
							budget_note =
								i > 0
									? `Ran ${i} of ${runs} renders — stopped early, a later render hung (the page or an upstream call did not return within ${Math.round(PER_RENDER_TIMEOUT_MS / 1000)}s).`
									: undefined;
							break;
						}
						// the body read chunk by chunk, each stamped: when each part of the document LEFT the
						// server (the byte strip draws it; a streamed page shows what held its first bytes)
						const { text: body, chunks } = await read_timed(res, t);
						const done = performance.now();
						run_status = res.status;
						run_bytes = body.length;
						// (what the page tells the browser to keep: `no-store` keeps it out of the back/forward cache)
						run_cache_control = res.headers.get('cache-control') ?? undefined;
						// (a cookie set on the response: no shared cache keeps such a page)
						if (res.headers.has('set-cookie')) run_sets_cookie = true;
						// each render's document, fingerprinted: the same bytes every time is a page to cache whole
						body_prints.push(`${fnv1a32(body)}:${body.length}`);
						if (!first_body) first_body = body;
						last_body = body;
						last_chunks = chunks;
						run_ms.push(round2(done - t));
						slowest = Math.max(slowest, done - t);
						run_windows.push({ start: t, end: done });
						// let the event loop turn once between renders: flushes the GC
						// PerformanceObserver (its entries arrive on a macrotask) and keeps
						// each render a clean, separately-attributed unit
						await new Promise((r) => setImmediate(r));
					}
				},
				{ gc_attr }
			);
			// Every render hung/failed → nothing to report. Don't build an empty report; tell the user.
			if (run_ms.length === 0) {
				return error(
					504,
					`The page did not return in time to profile it. It (or an upstream call it makes) is either hung or slower than the recording budget — try a lighter path, or check that page for a stuck request.`
				);
			}
			// ANOTHER VISITOR ON THIS SAME PAGE, mid-render: their work runs the same lines, so no stack
			// tells it apart — but the clock does. A render an outside request of this path overlapped
			// is left out, its samples set aside, when at least one render ran clean
			const target_path = target.split('?')[0];
			// …AND A VISITOR OF ANOTHER PAGE: its load's lines, its allocations, its calls all land in
			// the same window (/latecomer profiled while /inferno was asked for read inferno's patterns
			// as its own). A request the render made itself (its own API, served by this process) is the
			// render's: one whose path is a call the renders made is never "another visitor"
			const own_calls = new Set<string>();
			for (const c of cap.net) {
				try {
					own_calls.add(new URL(c.url, 'http://x').pathname);
				} catch {
					// ok: not a URL, so not a path the renders called
				}
			}
			const outside = this.#ring.filter(
				(e) =>
					!e.internal &&
					e.pt !== undefined &&
					(e.path === target_path ||
						(!own_calls.has(e.path.split('?')[0]) && !e.path.startsWith(this.base)))
			);
			const mixed_at = run_windows.map((w) =>
				outside.some((e) => e.pt! < w.end && (e.ms > 0 ? e.pt! + e.ms : Infinity) > w.start)
			);
			let runs_set_aside = 0;
			if (mixed_at.some(Boolean) && mixed_at.some((m) => !m)) {
				const aside: { start: number; end: number }[] = [];
				for (let i = run_windows.length - 1; i >= 0; i--) {
					if (!mixed_at[i]) continue;
					aside.push(run_windows[i]);
					run_windows.splice(i, 1);
					run_ms.splice(i, 1);
					body_prints.splice(i, 1);
					runs_set_aside++;
				}
				cap.set_aside = aside;
			}
			// THE SAME ANSWER EVERY TIME, read across EVERY run before the calls are scoped to one: a GET
			// that answered the same bytes in each render (the same-answer pattern, at report time)
			const stable = stable_answers(cap.net, run_windows);
			this.#kept?.keep(kept_owner, false);
			// ALMOST THE SAME ANSWER: made in every render, never the same bytes, yet the first and the
			// last differ only in a small stretch (a timestamp, a request id) — data that did not change
			const almost = new Map<string, string>();
			if (this.#kept) {
				for (const key of varied_answers(cap.net, run_windows)) {
					const d = this.#kept.diff(key);
					if (d && d.size >= 64 && d.bytes <= Math.max(48, d.size * 0.02)) almost.set(key, d.text);
				}
			}
			mem_mark('after the timed renders');
			// KEEP THE ANSWERS, MEASURED: the calls that answered the same bytes in every render, served
			// from memory in a few more renders — what caching them would take off, timed instead of
			// estimated (the request plumbing each call costs, a call to this same server's endpoint and
			// the CPU it spends answering, all gone too). Outside the CPU window; only this recording's
			// renders (a token on the request) are served, and only when the budget has room
			let answers: ReportMeta['answers'];
			if (stable.size && this.#kept) {
				const state = {
					// wall: unique across restarts
					token: `${fnv1a32(`${Math.random()}:${Date.now()}`).toString(36)}${fnv1a32(String(performance.now())).toString(36)}`,
					keys: stable
				};
				this.#answers = state;
				try {
					const ms: number[] = [];
					for (let i = 0; i < ANSWER_RENDERS; i++) {
						if (clock.mono() + slowest + retention_reserve() + coverage_reserve() > deadline) break;
						const t = performance.now();
						const res = await fetch_render(target, { [ANSWERS_HEADER]: state.token });
						await res.text();
						if (res.status !== run_status) break;
						ms.push(round2(performance.now() - t));
					}
					if (ms.length) answers = { runs_ms: ms, calls: stable.size };
				} catch {
					answers = undefined;
				} finally {
					if (this.#answers === state) this.#answers = null;
					this.#kept.drop(kept_owner);
				}
			}
			// EACH ENDPOINT'S WAITING IN EVERY RUN (its calls' own clocks), read before the calls are
			// scoped to one run: a wait row's spread over the renders, its network noise
			const wait_runs: Record<string, number[]> = {};
			for (const c of cap.net) {
				if (c.ms < 0) continue;
				const ri = run_windows.findIndex((w) => c.start >= w.start && c.start <= w.end);
				if (ri === -1) continue;
				const k = call_group(label_call(c.method, c.url));
				(wait_runs[k] ??= Array.from({ length: run_windows.length }, () => 0))[ri] +=
					c.ms + (c.body_ms ?? 0);
			}
			// TIMERS EVERY RENDER LEFT RUNNING, read before the io is scoped to one run: the same line
			// started one in each render, and each is still open after them all
			mark_left_each_run(cap.io_ops, run_windows);
			// N identical renders → N copies of the same outbound calls. Keep one render's worth so
			// the waterfall shows one request + its leaf calls, not the same handful ×N.
			cap.window = scope_net_to_one_run(cap, run_windows) ?? undefined;
			cap.runs = run_windows; // every run's window: the per-run component split
			// the cold render's per-file cost (the warm figures come from the main analysis at report time)
			let cold: ReportMeta['cold'];
			mem_mark('after the answer renders');
			const cold_route = this.#ring.find(
				(e) => e.internal && e.path === target_path && e.route
			)?.route;
			if (cold_cap && warmup_ms !== undefined) {
				try {
					// one "run" spanning the cold render: its CPU by owner, grouped as the drill-down groups
					// it (`owner_runs_ms`), so each row can say what it cost cold against warm
					const p = cold_cap.profile;
					const whole = {
						start: cold_cap.perf_start,
						end: cold_cap.perf_start + (p.endTime - p.startTime) / 1000
					};
					const a0 = analyze(
						p,
						await this.#make_resolver(),
						undefined,
						// (the route too: another page's request in the cold window is set aside like a warm run's)
						{
							perf_start: cold_cap.perf_start,
							window: whole,
							calls: [],
							runs: [whole],
							...(cold_route ? { route: cold_route } : {})
						},
						undefined,
						this.#module_hint
					);
					const owners = Object.entries(a0.owner_runs_ms ?? {})
						.map(([label, ms]) => ({ label, ms: ms[0] }))
						.filter((o) => o.ms >= 0.5)
						.sort((x, y) => y.ms - x.ms)
						.slice(0, 40);
					cold = {
						ms: warmup_ms,
						busy_ms: a0.busy_ms,
						files: a0.files
							.filter(
								(f) =>
									f.category !== 'idle' &&
									f.category !== 'gc' &&
									f.category !== 'profiler' &&
									f.self_ms >= 0.5
							)
							.slice(0, 40)
							.map((f) => ({ file: f.key, category: f.category, ms: f.self_ms })),
						...(owners.length ? { owners } : {}),
						calls: cold_cap.net.length
					};
				} catch {
					cold = undefined;
				}
			}
			// call counts come from ONE extra render under precise coverage — a
			// SEPARATE pass, because coverage stops V8 inlining and would otherwise
			// inflate the CPU profile (svelte's hot `child`/`push` would dominate).
			// Always run it (the ×N counts are the point) — the loop above reserved its time.
			// WHAT A RENDER LEAVES BEHIND: one more render under a live-objects sampler, a full
			// collection, then what is still alive by allocation site — outside the runs, and only
			// when the budget has room for another render
			mem_mark('after the answer renders and the cold analysis');
			let retained: Retained | undefined;
			// the pass's own wall time: a render with a heap sampler on and a full collection after it,
			// the real price of each growth-check render (the warm-up time alone was half of it)
			let retain_ms = 0;
			// its render plus the full collection after it, and the coverage render still to come
			// (not past HEAP_EXTRAS of the heap: the heap sampler's read itself needs room)
			const heap_ok = heap_fill() < HEAP_EXTRAS;
			if (gc_attr && this.want_heap && !heap_ok)
				heap_skipped.push('the render that measures what a render keeps');
			if (
				gc_attr &&
				this.want_heap &&
				heap_ok &&
				clock.mono() + retention_reserve() + coverage_reserve() < deadline
			) {
				try {
					const t = clock.mono();
					retained = await this.#retention_pass(async () => {
						await fetch_render(target).then((r) => r.text());
					});
					retain_ms = clock.mono() - t;
				} catch {
					retained = undefined;
				}
			}
			// DOES IT KEEP GROWING? When one more render left memory behind, a few more renders with a
			// full collection after each tell a leak (the heap climbs every time) from a bounded cache
			// still filling (it levels off). Only when there is something to confirm and time for it.
			mem_mark('after the retention render');
			let growth: HeapGrowth | undefined;
			if (retained && retained.total_bytes >= 256 * 1024) {
				// the lowest-priority extra: on a serverless budget (Amplify: 25 s of work) it never takes
				// the coverage render's time (the call counts come after it), and it stops by the clock,
				// not only by count; each render is priced by the retention pass's real wall time
				const each = Math.max(retain_ms, slowest + 300);
				const room = deadline - clock.mono() - coverage_reserve() - 1500;
				// (and by the heap's room: each render keeps what the retention render measured)
				const s = v8_stats?.();
				const heap_n = s
					? Math.floor((s.heap_size_limit * HEAP_STOP - s.used_heap_size) / retained.total_bytes)
					: Infinity;
				const n = Math.min(6, Math.floor(room / each), heap_n);
				if (heap_n < 3)
					heap_skipped.push(
						'the growth check (a few more renders, to tell a leak from a cache filling)'
					);
				if (n >= 3) {
					try {
						growth = await this.#growth_check(
							async () => {
								await fetch_render(target).then((r) => r.text());
							},
							n,
							clock.mono() + room
						);
					} catch {
						growth = undefined;
					}
				}
			}
			mem_mark('after the retention and growth renders');
			// (the call counts' render: not with the heap nearly full)
			const counted =
				heap_fill() < HEAP_STOP
					? await this.#count_calls(async () => {
							await fetch_render(target).then((r) => r.text());
						}, true)
					: (heap_skipped.push('the call-count render (the ×N counts)'),
						{ counts: {} as Record<string, number> });
			cap.call_counts = counted.counts;
			mem_mark('after the coverage render');
			// the app's own fetch answers a hashed asset on adapter-node (it reads the file); a
			// preview / static host serves it over the wire instead, so fall back to the origin
			const app_fetch = async (u: string, signal?: AbortSignal): Promise<Response> => {
				try {
					const r = await event.fetch(u, { headers: { 'x-og-profiler-internal': '1' }, signal });
					if (r.ok) return r;
				} catch {
					// ok: not answered internally; the origin is asked below
				}
				return fetch(new URL(u, event.url.origin), {
					headers: { 'x-og-profiler-internal': '1' },
					signal
				});
			};
			const id = await this.#finish_report(
				cap,
				{
					trigger: 'page',
					page: target,
					redirected_from,
					...(redirect_stub ? { redirect_stub: true as const } : {}),
					// plain AWS Lambda (Amplify); Vercel and Netlify run on it too but bill differently
					...(process.env.AWS_LAMBDA_FUNCTION_NAME && !process.env.VERCEL && !process.env.NETLIFY
						? {
								lambda: true,
								// the memory it is billed for, with every ms of the render's wall time
								...(Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) > 0
									? { lambda_mb: Number(process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) }
									: {})
							}
						: {}),
					// the heap this instance may grow to before it dies (a leak's runway is measured in it)
					heap_limit_mb: Math.round(
						(await import('node:v8')).getHeapStatistics().heap_size_limit / 1048576
					),
					// the instance this ran on: how long it took to take its first request (its cold start
					// on Lambda), Node's own share of that, its age and how many requests it served before
					instance: {
						first_request_ms: round2(this.#first_request_pt ?? 0),
						node_ms: round2(
							(performance as unknown as { nodeTiming?: { bootstrapComplete?: number } }).nodeTiming
								?.bootstrapComplete ?? 0
						),
						age_s: Math.round(performance.now() / 100) / 10,
						requests_before
					},
					warmup_ms,
					run_status,
					run_bytes,
					...(run_cache_control ? { run_cache_control } : {}),
					...(run_sets_cookie ? { run_sets_cookie: true as const } : {}),
					// Kit's route id of the timed renders (the request log has them, by path): what the route's
					// own files say — a prerendered route — without a source map
					// — and none at all (a 200 the app's handle never saw): the page was served as the file the
					// build wrote, before the app (a prerendered page in a server that serves its files first)
					...(() => {
						const path = target.split('?')[0];
						for (let k = this.#ring.length - 1; k >= 0; k--) {
							const e = this.#ring[k];
							if (e.path === path) return e.route ? { run_route: e.route } : {};
						}
						return run_status === 200 && !this.dev ? { run_static: true as const } : {};
					})(),
					budget_note,
					...(heap_skipped.length ? { heap_guard: heap_guard() } : {}),
					runs: run_ms,
					...(runs_set_aside ? { runs_set_aside } : {}),
					...(body_prints.length >= 2 && body_prints.every((p) => p === body_prints[0])
						? { same_document: true }
						: {}),
					...(cold ? { cold } : {}),
					...(answers ? { answers } : {})
				},
				app_fetch
			);
			mem_mark('after the report was built');
			const s = this.#reports.get(id)!;
			if (retained) s.retained = retained;
			if (growth) s.growth = growth;
			// WHAT CHANGES BETWEEN RENDERS: the first document against the last, grouped (an island's
			// props, an attribute stamped per render, comment markers) — islands named by their entry
			if (!s.meta.same_document && first_body && last_body && run_ms.length >= 2) {
				try {
					const rows = island_rows_of(s.meta);
					const name_of = (entry: string) => {
						const tail = entry.startsWith('.') ? entry.slice(1) : entry;
						const r = rows.find((x) => x.entry === tail || x.entry.endsWith(tail));
						return r ? island_name(r) : undefined;
					};
					const diff = doc_diff(first_body, last_body, name_of);
					if (diff) s.meta.doc_diff = diff;
				} catch {
					// ok: a report without the documents' diff; the rest stands
				}
			}
			// THE DOCUMENT AS BYTES and THE DATA RIVER, from the last run's body
			if (last_body) {
				try {
					s.strip = byte_strip(last_body);
					if (last_chunks.length > 1) {
						s.strip.chunks = last_chunks;
						// (what held it open: the late tail after the longest pause, by page.data key)
						const tail = stream_tail(last_body, s.strip, last_chunks);
						if (tail) s.strip.tail = tail;
					}
				} catch {
					// ok: a document the scanner cannot walk: no byte strip
				}
				// THE PAGE'S WEIGHT: every file the document loads at start (whatever built it) and
				// the islands' modules, weighed through the app — the score's JS / weight / blocking.
				// A dev server serves modules one by one: its graph says nothing about a build.
				if (this.dev)
					s.assets_missing =
						'the dev server serves modules one by one, so its JS says nothing about a build: profile a build (preview or deploy) to weigh the page';
				else {
					try {
						const extra: AssetRef[] = [];
						for (const r of island_rows_of(s.meta)) {
							const lazy = r.wake !== 'load' && r.wake !== 'idle';
							for (const u of [r.module_url, ...r.hints])
								if (u)
									extra.push({
										url: u,
										kind: 'script',
										blocking: false,
										via: 'island',
										...(lazy ? { lazy: true } : {})
									});
						}
						const { gzipSync } = await import('node:zlib');
						s.assets = await weigh_assets({
							html: last_body,
							page_url: new URL(target, event.url.origin).href,
							fetch_url: app_fetch,
							cache: this.#asset_weights,
							gzip: (b) => gzipSync(b, { level: 6 }).byteLength,
							// `weigh=full`: every file, however long (on a server with no request limit — on a
							// serverless one, what the request has left), so the totals do not vary run to run
							budget_ms:
								q.get('weigh') === 'full'
									? Math.max(500, Math.min(120_000, request_deadline - clock.mono() - 4000))
									: Math.max(500, Math.min(6000, request_deadline - clock.mono() - 8000)),
							...(q.get('weigh') === 'full' ? { max_files: 2000 } : {}),
							extra,
							// the build's readable list of what a hashed chunk holds (keyed by its served path)
							contents_of: (u) => {
								try {
									const path = new URL(u).pathname;
									const rel = app_asset_rel(path);
									return chunk_contents(rel ? `/${rel}` : path);
								} catch {
									return null;
								}
							}
						});
					} catch {
						s.assets_missing = 'the page could not be weighed';
					}
				}
				try {
					s.river = await this.#river_for(s, last_body, run_windows[run_windows.length - 1]);
				} catch {
					// ok: a report without its river; the rest stands
				}
				try {
					s.lineage = await this.#lineage_for(s, last_body);
				} catch {
					// ok: a report without its lineage; the rest stands
				}
			}
			// THE LINE LEDGER, now that the retained sites are in: the app lines that cost the most
			try {
				await this.#lines_for(s, counted.profile, cap.window?.start, stable, wait_runs, almost);
			} catch {
				// ok: a report without its line ledger; the rest of the report stands
			}
			// the durable copy, with every extra in, so a report read back from the store (another
			// instance, a restart) carries all of them. AWAITED, up to a bound: on a serverless host the
			// process freezes once the response is out, and a write still running then may never land
			// (never into the platform's own cut: what is left of it, less a margin for the answer)
			const persist_wait = Math.max(
				200,
				Math.min(PERSIST_WAIT_MS, request_deadline - clock.mono() - 2_000)
			);
			// (the bound's timer is the request's, and goes the moment the write lands)
			const bound = scope(current_request_scope() ?? undefined);
			await Promise.race([this.#persist(s), pause(bound, persist_wait)]).finally(() =>
				bound.close()
			);
			// `keep`: the run page asks for the report's dump in the answer so the BROWSER keeps it
			// (IndexedDB) — on an ephemeral host the instance that rendered it is gone before the
			// report page is opened, and a persistent one may restart
			if (q.get('format') === 'keep') {
				return ctx.json({
					id,
					url: ctx.href('/report/[id]', { id }),
					dump: report_dump(s.analysis, s.meta, this.#report_extras(s))
				});
			}
			// serverless (Amplify/Vercel/Netlify) can't keep the report in memory across invocations
			// AND a fresh instance may serve the follow-up render — so `?format=ogp` streams the whole
			// profile back NOW as an encrypted `.ogp` the user re-opens at `<base>/view`. This is also
			// the reliable path when the full report is too heavy for the browser. `?format=json` is
			// the curated agent view.
			if (q.get('format') === 'ogp') {
				return this.#ogp_response(id, s);
			}
			const wants_json =
				q.get('format') === 'json' ||
				(ctx.request.headers.get('accept') ?? '').includes('application/json');
			if (wants_json) {
				// with "since your last profile" of this page: what an agent iterating on a fix reads first
				const since = await this.#since_for(s, this.#prev_in_memory(s));
				// its fixes that make other pages faster too (the lines they share)
				const shared = this.#shared_of(s.meta);
				const full: Record<string, unknown> = {
					...report_json(s.analysis, s.meta, this.base, this.#report_extras(s)),
					...(since ? { since } : {}),
					...(shared.length ? { shared } : {})
				};
				// `fields=a,b`: only those top-level keys (and what names the report) — a CI run reading a few
				// sections of hundreds of profiles need not carry the stacks
				return ctx.json(pick_fields(full, q.get('fields')));
			}
			// the session cookie is seated by the gate in #ui, not here
			return ctx.redirect(ctx.href('/report/[id]', { id }));
		} catch (e) {
			// A deliberate `error()`/`redirect()` from inside the try (bad path 400, empty-runs 504, …) is a
			// control-flow throw the router renders — let it through. Only a REAL exception becomes a 500.
			if (is_http_error(e) || is_redirect(e)) throw e;
			return error(
				500,
				e instanceof Error && INSPECTOR_ERR.test(e.message)
					? 'CPU profiling needs a Node.js server (adapter-node or dev). This platform does not expose the V8 inspector.'
					: `Profiling failed: ${e instanceof Error ? e.message : String(e)}`
			);
		} finally {
			// (a recording that threw mid-way leaves no answers kept; the answers' own `finally` stops
			// any render being served them)
			this.#kept?.drop(kept_owner);
			this.#free(token);
		}
	}

	// Open a saved profile (the /view POST). The upload island POSTs the .ogp bytes + key and expects
	// JSON: `{ url }` to navigate to, or `{ error }`. We STORE the dump and hand back its /report/<id>
	// URL rather than render inline — the report is an islands page, so it must load normally to hydrate.
	async #upload(ctx: RouteCtx): Promise<Response> {
		try {
			// Tolerate a `.ogp` mangled by a text-y transfer between machines (a prepended BOM, or the whole
			// file base64-encoded) — recover the raw bytes before checking the magic.
			const raw = await read_capped(ctx.request, MAX_POSTED_REPORT);
			if (raw === null)
				return ctx.json(
					{
						error: `That file is over ${MAX_POSTED_REPORT / 1_048_576} MB, past any real profile.`
					},
					{ status: 413 }
				);
			const bytes = recover_ogp_bytes(raw);
			if (!is_ogp(bytes)) {
				return ctx.json(
					{
						error: `That file is not an ogygia .ogp profile. If you moved it between machines, copy it as a binary file — a text editor or chat can silently re-encode it.`
					},
					{ status: 400 }
				);
			}
			// Brotli + AES-GCM. Decrypt with the key the uploader supplies (`x-ogp-key`) so ANY .ogp opens
			// in ANY profiler — its key can differ from this instance's secret. Left blank, we fall back to
			// THIS profiler's own secret, so the reports it made re-open without retyping the key (the
			// upload form says so). A wrong key fails the GCM tag → caught below.
			const ogp_key = ctx.request.headers.get('x-ogp-key') || this.secret;
			const dump: unknown = await ogp_decode(bytes, ogp_key);
			if (!is_dump(dump)) {
				return ctx.json({ error: 'That file is not an ogygia profiler dump.' }, { status: 400 });
			}
			return ctx.json({ url: ctx.href('/report/[id]', { id: this.#store_uploaded(dump) }) });
		} catch (e) {
			if (e instanceof OgygiaError && e.code === 'devtools_profiler_upload_too_large')
				return ctx.json({ error: e.message }, { status: 413 });
			return ctx.json(
				{ error: "That file isn't a profile, or it was made with a different key." },
				{ status: 400 }
			);
		}
	}

	// The report page, its JSON, and its raw .cpuprofile all take the ALREADY-looked-up report — the
	// shared `/report/[id]` layer load in profiler-router does the lookup + 404 once and cascades it.
	/** the lines two or more profiled pages share, over the latest report of each page this server holds */
	#site_fixes(limit = 8) {
		return site_fixes(
			[...this.#reports.values()]
				.filter(
					(r) => r.meta.trigger === 'page' && r.meta.page && (r.meta.run_status ?? 200) === 200
				)
				.map((r) => ({
					id: r.meta.id,
					page: r.meta.page!,
					created: r.meta.created,
					runs: r.meta.runs?.length || 1,
					patterns: r.patterns
				})),
			limit
		);
	}

	/** of those, the ones this report's page is among: its fixes that make other pages faster too */
	#shared_of(meta: ReportMeta) {
		if (meta.trigger !== 'page' || !meta.page) return [];
		// (all of them first, then this page's: a cut before the filter could drop its lines)
		return this.#site_fixes(Infinity)
			.filter((f) => f.pages.some((p) => p.page === meta.page))
			.slice(0, 5);
	}

	async #report_json(stored: StoredReport): Promise<Response> {
		const since = await this.#since_for(stored, this.#prev_in_memory(stored));
		const shared = this.#shared_of(stored.meta);
		const body = {
			...report_json(stored.analysis, stored.meta, this.base, this.#report_extras(stored)),
			...(since ? { since } : {}),
			...(shared.length ? { shared } : {})
		};
		return new Response(JSON.stringify(body), {
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	}

	/** The RAW dump JSON (`{ kind, version, meta, analysis, extras }`) the share-link viewer renders —
	 *  the same shape `.ogp` carries. Authed (only the owner mints a link); the recipient never hits it. */
	#report_dump_json(stored: StoredReport): Response {
		const body = report_dump(stored.analysis, stored.meta, this.#report_extras(stored));
		return new Response(JSON.stringify(body), {
			headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
		});
	}

	async #report_raw(stored: StoredReport): Promise<Response> {
		let body: string;
		if (typeof stored.raw === 'string') {
			body = stored.raw;
		} else {
			try {
				const { gunzipSync } = await import('node:zlib');
				body = gunzipSync(stored.raw).toString('utf8');
			} catch {
				// no zlib to inflate — serve the gzip bytes with the encoding header
				return new Response(new Uint8Array(stored.raw), {
					headers: {
						'content-type': 'application/json',
						'content-encoding': 'gzip',
						'content-disposition': `attachment; filename="ssr-${stored.meta.id}.cpuprofile"`,
						'cache-control': 'no-store'
					}
				});
			}
		}
		return new Response(body, {
			headers: {
				'content-type': 'application/json',
				'content-disposition': `attachment; filename="ssr-${stored.meta.id}.cpuprofile"`,
				'cache-control': 'no-store'
			}
		});
	}

	/**
	 * Render a report page with its dump embedded as an encrypted `.ogp` (base64), so the Export button
	 * downloads it with no server round-trip (the report may be evicted by then) and no key in the page.
	 * Encoding is async (Brotli + scrypt off-thread — never blocks the event loop) and best-effort: if
	 * Node crypto/zlib is unavailable (a stripped edge runtime), the Export button is simply omitted and
	 * the JSON / .cpuprofile links still work.
	 */
	async #report_view(stored: StoredReport) {
		const { analysis: a, meta } = stored;
		const extras = this.#report_extras(stored);
		let ogpB64: string | undefined;
		try {
			const bytes = await ogp_encode(report_dump(a, meta, extras), this.secret);
			ogpB64 = Buffer.from(bytes).toString('base64');
		} catch {
			ogpB64 = undefined;
		}
		// this page's other page-mode reports (oldest first) and the one just before this one — the
		// history line + the "compare with previous" link
		const history =
			meta.trigger === 'page' && meta.page
				? (page_history([...this.#reports.values()].map((r) => r.meta)).find(
						(h) => h.page === meta.page
					) ?? null)
				: null;
		const i = history ? history.points.findIndex((p) => p.id === meta.id) : -1;
		const since = await this.#since_for(stored, i > 0 ? history!.points[i - 1].id : null);
		return {
			a,
			meta,
			base: this.base,
			extras,
			ogpB64,
			history,
			prev: since?.prev ?? (i > 0 ? history!.points[i - 1].id : null),
			since,
			dev: this.dev
		};
	}

	/**
	 * SINCE THE LAST PROFILE of this page: the comparison, cut to what a reader needs at the top — the
	 * render's change, the rows that really moved (inlining shifts left out), the order trap, the fix
	 * check. The previous report from this instance's memory, else (it restarted; a serverless
	 * instance is new) the configured store's newest earlier report of the same page.
	 */
	async #since_for(stored: StoredReport, prev_in_memory: string | null): Promise<Since | null> {
		const { meta } = stored;
		let prev = prev_in_memory;
		if (!prev && meta.trigger === 'page' && meta.page) {
			try {
				const earlier = (await this.#list_stored(50))
					.filter((r) => r.page === meta.page && r.id !== meta.id && r.created < meta.created)
					.sort((a, b) => b.created - a.created)[0];
				if (earlier) prev = earlier.id;
			} catch {
				// ok: no store to list: no earlier report to compare with
			}
		}
		const P = prev ? (this.#reports.get(prev) ?? (await this.#report_load(prev))) : undefined;
		if (!P) return null;
		try {
			const cmp = compare_reports(this.#pack(P), this.#pack(stored));
			const render = cmp.summary.find((r) => r.label.startsWith('render'));
			// the page score then and now (each read with its own extras), and which categories moved it
			let score: Since['score'];
			try {
				const sa = page_score_of(P.meta, this.#report_extras(P));
				const sb = page_score_of(stored.meta, this.#report_extras(stored));
				const moved = sb.categories
					.map((c) => ({
						key: c.key,
						label: c.label,
						b: c.score,
						a: sa.categories.find((x) => x.key === c.key)?.score ?? NaN
					}))
					.filter((m) => Number.isFinite(m.a) && Math.abs(m.b - m.a) >= 3)
					.sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))
					.slice(0, 3);
				score = { a: sa.score, b: sb.score, a_grade: sa.grade, b_grade: sb.grade, moved };
			} catch {
				score = undefined;
			}
			// the files behind a JS move (both builds weighed)
			let assets: Since['assets'];
			try {
				if (P.assets && stored.assets) {
					const d = assets_diff(P.assets, stored.assets);
					if (
						d.added.length ||
						d.removed.length ||
						d.grew.length ||
						d.shrank.length ||
						d.to_start.length ||
						d.to_later.length
					)
						assets = d;
				}
			} catch {
				assets = undefined;
			}
			// the browser's findings then and now (each report with its own visit): fixed and new, by
			// finding and island — "clicked before it woke" gone after a wake change is the answer to
			// "did it work", as much as the render time
			let browser: Since['browser'];
			try {
				const bf = (s: typeof stored) => {
					const e = this.#report_extras(s);
					if (!e.visit) return null;
					const names = new Map(island_rows_of(s.meta).map((r) => [r.fp, r.name]));
					return derive_findings(s.analysis, s.meta, e)
						.filter((f) => f.fps)
						.map(
							(f) =>
								`${f.code}${f.fps!.length ? ` (${[...new Set(f.fps!.map((fp) => names.get(fp) ?? fp.slice(0, 6)))].sort().join(', ')})` : ''}`
						);
				};
				const was = bf(P);
				const now = bf(stored);
				if (was && now) {
					const fixed = was.filter((x) => !now.includes(x));
					const added = now.filter((x) => !was.includes(x));
					if (fixed.length || added.length) browser = { fixed, added };
				}
			} catch {
				browser = undefined;
			}
			// THE VITALS THAT MOVED (each report's own visit), and the part of each that moved most
			let vitals: Since['vitals'];
			try {
				const va = this.#report_extras(P).visit;
				const vb = this.#report_extras(stored).visit;
				if (va && vb) {
					const input = (v: Visit): PageInput => ({
						vitals: v.vitals ?? {},
						visit: {
							nav: v.nav,
							paints: v.paints,
							resources: v.resources,
							interaction: v.interaction,
							font_faces: v.font_faces
						},
						islands: [],
						firsts: [],
						shifts: [],
						longtasks: []
					});
					const moved = vitals_moved(va.vitals ?? {}, vb.vitals ?? {}, (side, key) =>
						vital_parts(input(side === 'a' ? va : vb), key)
					);
					if (moved.length) vitals = moved;
				}
			} catch {
				vitals = undefined;
			}
			// which islands changed file between the two builds: what a returning visitor downloads again
			let islands: Since['islands'];
			try {
				islands =
					island_files_diff(
						island_rows_of(P.meta),
						island_rows_of(stored.meta),
						(u) => stored.weights?.[u]
					) ?? undefined;
			} catch {
				islands = undefined;
			}
			return {
				prev: P.meta.id,
				...(score ? { score } : {}),
				...(browser ? { browser } : {}),
				...(vitals ? { vitals } : {}),
				...(islands ? { islands } : {}),
				...(assets ? { assets } : {}),
				...(render ? { a_ms: render.a, b_ms: render.b } : {}),
				...(cmp.render_same ? { same: true } : {}),
				moved: (cmp.drill ?? []).filter((r) => r.status !== 'shifted').slice(0, 3),
				...(cmp.order ? { order: cmp.order } : {}),
				...(cmp.fix_check ? { fix_check: cmp.fix_check } : {})
			};
		} catch {
			return null;
		}
	}

	/** this page's report just before `stored`, in this instance's memory */
	#prev_in_memory(stored: StoredReport): string | null {
		const { meta } = stored;
		if (meta.trigger !== 'page' || !meta.page) return null;
		const h = page_history([...this.#reports.values()].map((r) => r.meta)).find(
			(x) => x.page === meta.page
		);
		const i = h ? h.points.findIndex((p) => p.id === meta.id) : -1;
		return i > 0 ? h!.points[i - 1].id : null;
	}

	/** Store an uploaded dump as a report so it renders (+ hydrates) at its own /report/<id> URL — an
	 *  islands page can't be swapped in via document.write. No cpuprofile in a dump, so `raw` is empty
	 *  (its /raw link just 404s; everything else works). */
	#store_uploaded(dump: { analysis: Analysis; meta: ReportMeta; extras: ReportExtras }): string {
		const id = Math.random().toString(36).slice(2, 10);
		this.#reports.set(id, this.#report_from_dump({ ...dump, meta: { ...dump.meta, id } }));
		while (this.#reports.size > this.max_reports) {
			const oldest = this.#reports.keys().next().value;
			if (oldest === undefined) break;
			this.#reports.delete(oldest);
		}
		return id;
	}

	/** A StoredReport rebuilt from a portable dump (an uploaded `.ogp`, or one read back from the
	 *  storage backend). No cpuprofile survives a dump, so `raw` is empty (the `/raw` link 404s). */
	#report_from_dump(dump: {
		analysis: Analysis;
		meta: ReportMeta;
		extras: ReportExtras;
	}): StoredReport {
		const e = dump.extras;
		return {
			meta: dump.meta,
			analysis: dump.analysis,
			heap: e.heap,
			...(e.heap_components ? { heap_components: e.heap_components } : {}),
			net: e.net,
			mem: e.mem,
			measures: e.measures ?? [],
			gc: e.gc ?? null,
			io: e.io ?? [],
			call_counts: e.call_counts ?? {},
			raw: '',
			...(e.weights ? { weights: e.weights } : {}),
			...(e.contents ? { contents: e.contents } : {}),
			...(e.heavy ? { heavy: e.heavy } : {}),
			...(e.barrels ? { barrels: e.barrels } : {}),
			...(e.hazards ? { hazards: e.hazards } : {}),
			...(e.client ? { client: e.client } : {}),
			...(e.vitals ? { vitals: e.vitals } : {}),
			...(e.client_marks ? { client_marks: e.client_marks } : {}),
			...(e.client_cpu ? { client_cpu: e.client_cpu } : {}),
			...(e.interaction_cpu ? { interaction_cpu: e.interaction_cpu } : {}),
			...(e.alloc ? { alloc: e.alloc } : {}),
			...(e.contention ? { contention: e.contention } : {}),
			...(e.lineage ? { lineage: e.lineage } : {}),
			// the fields the dump carries that were being dropped on reload — the GC attribution, the
			// data river, the document strip, what a render retains, the spans, the visit
			...(e.spans ? { spans: e.spans } : {}),
			...(e.visit ? { visit: e.visit } : {}),
			...(e.strip ? { strip: e.strip } : {}),
			...(e.assets ? { assets: e.assets } : {}),
			...(e.assets_missing ? { assets_missing: e.assets_missing } : {}),
			...(e.river ? { river: e.river } : {}),
			...(e.gc_attr ? { gc_attr: e.gc_attr } : {}),
			...(e.promises ? { promises: e.promises } : {}),
			...(e.retained ? { retained: e.retained } : {}),
			...(e.ledger ? { ledger: e.ledger } : {}),
			...(e.patterns ? { patterns: e.patterns } : {}),
			...(e.drill ? { drill: e.drill } : {}),
			...(e.forecast ? { forecast: e.forecast } : {}),
			...(e.growth ? { growth: e.growth } : {})
		};
	}

	/** Write a finished report to the durable store, when one is configured (a store failure never
	 *  fails the recording). The dump is the same portable JSON the `.ogp` export uses. The returned
	 *  promise settles when the write did: a serverless host freezes the process once the response
	 *  is sent, so a write left running after it may never land — the page recording awaits it. */
	/** The durable store, once its `init` has succeeded; null when none is configured or its init
	 *  failed this time (said, and tried again by the next use). */
	async #store_ready(): Promise<import('./storage/index.ts').ProfilerStore | null> {
		const store = this.#store;
		if (!store || !this.#store_init) return store;
		try {
			// (nothing drops the init, so it is never STALE)
			return (await this.#store_init.get()) === STALE ? null : store;
		} catch (e) {
			console.error(new OgygiaError('devtools_profiler_store_init_failed'), e);
			return null;
		}
	}

	#persist(stored: StoredReport): Promise<void> {
		if (!this.#store) return Promise.resolve();
		const meta = stored.meta;
		const median = meta.runs?.length
			? [...meta.runs].sort((a, b) => a - b)[Math.floor(meta.runs.length / 2)]
			: null;
		const rec = {
			id: meta.id,
			created: meta.created,
			page: meta.page ?? null,
			trigger: meta.trigger,
			label: meta.page ?? meta.request?.path ?? meta.id,
			median,
			dump: JSON.stringify(report_dump(stored.analysis, meta, this.#report_extras(stored)))
		};
		return Promise.resolve()
			.then(async () => {
				const store = await this.#store_ready();
				if (!store) return;
				await store.putReport(rec);
				await store.prune?.(Math.max(this.max_reports * 8, 200));
			})
			.catch((err) => {
				if (process.env.OGYGIA_PROFILER_DEBUG)
					console.error(new OgygiaError('devtools_profiler_put_report_failed'), err);
			});
	}

	/** Memory first, then the durable store: read the dump back, reconstruct, cache in memory. */
	async #report_load(id: string | undefined): Promise<StoredReport | undefined> {
		if (!id) return undefined;
		const hit = this.#reports.get(id);
		if (hit) return hit;
		const store = await this.#store_ready();
		if (!store) return undefined;
		try {
			const json = await store.getReport(id);
			if (!json) return undefined;
			const dump = JSON.parse(json) as {
				analysis: Analysis;
				meta: ReportMeta;
				extras: ReportExtras;
			};
			if (!dump?.meta || !dump.analysis) return undefined;
			const stored = this.#report_from_dump({ ...dump, meta: { ...dump.meta, id } });
			this.#reports.set(id, stored); // warm the hot cache
			return stored;
		} catch (err) {
			if (process.env.OGYGIA_PROFILER_DEBUG)
				console.error(new OgygiaError('devtools_profiler_get_report_failed'), err);
			return undefined;
		}
	}

	/** The reports the durable store holds (summaries), newest first — the sidebar's shared list. */
	async #list_stored(
		limit = 20
	): Promise<{ id: string; label: string; page?: string; created: number }[]> {
		const store = await this.#store_ready();
		if (!store) return [];
		try {
			const rows = await store.listReports(limit);
			return rows.map((r) => ({
				id: r.id,
				label: r.label,
				page: r.page ?? undefined,
				created: r.created
			}));
		} catch {
			return [];
		}
	}

	/** The full profile as an encrypted `.ogp` download (Brotli + AES-GCM, async — never blocks). */
	async #ogp_response(id: string, stored: StoredReport): Promise<Response> {
		const bytes = await ogp_encode(
			report_dump(stored.analysis, stored.meta, this.#report_extras(stored)),
			this.secret
		);
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename="profile-${id}.ogp"`,
				'cache-control': 'no-store'
			}
		});
	}

	#report_extras(stored: StoredReport): ReportExtras {
		const client = stored.client ?? this.#client_for(stored);
		// THE BROWSER'S PAGE: what the beacon files its messages under — the document's path, no query.
		// A report of a redirect that lands with a query (`/dt-ttfb-go` → `/dt-ttfb?fast`) is of that
		// path and query, and read its visits, vitals and traces under it: none, ever
		const browser_page = stored.meta.page?.split('?')[0];
		const vitals = stored.vitals ?? this.#vitals_for(browser_page);
		const client_marks = stored.client_marks ?? this.#marks_for(browser_page);
		const client_cpu =
			stored.client_cpu ?? (browser_page ? this.#client_cpus.get(browser_page) : undefined);
		// THE REPORT'S OWN VISIT: the first page load that started after the report was made (the
		// profiling visit), not simply the latest — every report of a page read the newest visit, so
		// an older report showed later loads' browser picture and "since your last profile" compared a
		// visit with itself. The latest stays the fallback (no visit since: the one before). A second
		// of slack for the browser's clock against the server's.
		const own_visit = (): Visit | undefined => {
			const created = stored.meta.created - 1000;
			if (stored.visit && stored.visit.at >= created) return stored.visit;
			const list = browser_page ? (this.#visits.get(browser_page) ?? []) : [];
			let first: Visit | undefined;
			for (const v of list) if (v.at >= created && (!first || v.at < first.at)) first = v;
			return first ?? stored.visit ?? list.at(-1);
		};
		const visit = own_visit();
		// THE VISIT'S HOLE REQUESTS: the recording ends with the page's render, so a hole's own
		// request (made by the browser afterwards) is not in it. The request log still holds it: the
		// visit's holes, requested within a minute of its start, give each hole's server render (its
		// wait for a render slot taken out: the beacon's Server-Timing tells that part apart)
		const answered = new Set((visit?.holes_answered ?? []).map((h) => h.id));
		const hole_requests = answered.size
			? this.#ring
					.filter(
						(e) =>
							e.hole &&
							answered.has(e.hole.id) &&
							e.ts >= visit!.at - 1000 &&
							e.ts <= visit!.at + 60_000
					)
					.map((e) => ({
						id: e.hole!.id,
						ms: Math.max(0, e.ms - (e.hole!.queue_ms ?? 0)),
						...(e.hole!.name ? { name: e.hole!.name } : {}),
						...(e.hole!.p ? { p: e.hole!.p } : {})
					}))
			: [];
		// THE VISIT'S NAVIGATIONS, SERVER SIDE: each in-app navigation fetched a page, and that request
		// is in the log — what the server did with the wait the browser saw (its CPU, its outbound
		// calls, the rest). Matched by path, the latest one that started between a prefetch's reach
		// (10 s before the click) and the page's arrival, on the one epoch clock
		const nav_requests = (visit?.navs ?? [])
			.map((n) => {
				const lo = visit!.at + n.t - 10_000;
				const hi = visit!.at + n.fetched + 50;
				let hit: RequestEntry | undefined;
				for (const e of this.#ring) {
					if (
						e.internal ||
						e.method !== 'GET' ||
						e.path + (e.search ?? '') !== n.to ||
						e.ts < lo ||
						e.ts > hi
					)
						continue;
					if (!hit || e.ts > hit.ts) hit = e;
				}
				return hit
					? {
							t: n.t,
							ms: Math.round(hit.ms),
							cpu_ms: Math.round(hit.cpu_ms),
							net_ms: Math.round(hit.net_ms),
							net_count: hit.net_count,
							...(hit.inflight ? { inflight: hit.inflight } : {})
						}
					: null;
			})
			.filter((x): x is NonNullable<typeof x> => !!x);
		// THE VISIT'S OWN DOCUMENT REQUEST, SERVER SIDE: the log's entry for the page request this visit
		// made (its path, started within the visit's first byte) — how long the server's handler held it
		// beside the browser's wait for the first byte, so a gap between the render and TTFB is told
		// apart: before the handler (a proxy, a cold start, the network) or inside it
		let doc_request: { ms: number } | undefined;
		if (visit?.nav && stored.meta.page) {
			const path = stored.meta.page.split('?')[0];
			for (const e of this.#ring) {
				if (e.internal || e.method !== 'GET' || e.path !== path) continue;
				if (e.ts < visit.at - 500 || e.ts > visit.at + visit.nav.res_start + 500) continue;
				doc_request = { ms: Math.round(e.ms) };
			}
		}
		// THE VISIT'S SLOWEST INTERACTION, SAMPLED: the page's latest interaction trace, when it is this
		// visit's (the same interaction start, on the page clock)
		const icpu =
			stored.interaction_cpu ??
			(browser_page ? this.#interaction_cpus.get(browser_page) : undefined);
		const interaction_cpu =
			icpu && visit?.interaction && Math.abs(icpu.t - visit.interaction.t) < 2 ? icpu : undefined;
		// THE OTHER KIND OF SCREEN: the latest kept visit on a phone when this one was wide (or the other
		// way): the islands below its first screen, or hidden on it, are another list
		const narrow = (v: Visit) => (v.viewport?.[0] ?? 0) < NARROW_SCREEN_PX;
		const other_screen_visit =
			visit?.viewport && browser_page
				? (this.#visits.get(browser_page) ?? [])
						.filter((v) => v !== visit && v.viewport && narrow(v) !== narrow(visit))
						.at(-1)
				: undefined;
		// THE OTHER ENGINE: the latest kept visit from another browser engine (Safari beside Chrome):
		// what one engine shows, another may never (a preload refetched, a font holding the first paint)
		const engine = engine_of(visit?.ua);
		const other_engine_visit =
			engine && browser_page
				? (this.#visits.get(browser_page) ?? [])
						.filter((v) => v !== visit && engine_of(v.ua) && engine_of(v.ua) !== engine)
						.at(-1)
				: undefined;
		// (the modules the build shipped twice: the report names the ones this page loads both copies of)
		const dupes = chunk_duplicates();
		return {
			...(visit ? { visit } : {}),
			...(other_screen_visit ? { other_screen_visit } : {}),
			...(other_engine_visit ? { other_engine_visit } : {}),
			...(dupes ? { dupes } : {}),
			...(interaction_cpu ? { interaction_cpu } : {}),
			...(hole_requests.length ? { hole_requests } : {}),
			...(nav_requests.length ? { nav_requests } : {}),
			...(doc_request ? { doc_request } : {}),
			...(stored.strip ? { strip: stored.strip } : {}),
			...(stored.assets ? { assets: stored.assets } : {}),
			...(stored.assets_missing ? { assets_missing: stored.assets_missing } : {}),
			...(stored.river ? { river: stored.river } : {}),
			...(stored.gc_attr ? { gc_attr: stored.gc_attr } : {}),
			...(stored.promises ? { promises: stored.promises } : {}),
			...(stored.retained ? { retained: stored.retained } : {}),
			...(stored.alloc ? { alloc: stored.alloc } : {}),
			...(stored.contention ? { contention: stored.contention } : {}),
			...(stored.lineage ? { lineage: stored.lineage } : {}),
			...(stored.ledger ? { ledger: stored.ledger } : {}),
			...(stored.patterns ? { patterns: stored.patterns } : {}),
			...(stored.drill ? { drill: stored.drill } : {}),
			...(stored.forecast ? { forecast: stored.forecast } : {}),
			...(stored.growth ? { growth: stored.growth } : {}),
			net: stored.net,
			spans: stored.spans ?? [],
			heap: stored.heap,
			...(stored.heap_components ? { heap_components: stored.heap_components } : {}),
			mem: stored.mem,
			measures: stored.measures,
			gc: stored.gc,
			io: stored.io,
			call_counts: stored.call_counts,
			...(stored.weights ? { weights: stored.weights } : {}),
			...(stored.contents ? { contents: stored.contents } : {}),
			...(stored.heavy ? { heavy: stored.heavy } : {}),
			...(stored.barrels ? { barrels: stored.barrels } : {}),
			...(stored.hazards ? { hazards: stored.hazards } : {}),
			...(client.length ? { client } : {}),
			...(vitals ? { vitals } : {}),
			...(client_marks?.length ? { client_marks } : {}),
			...(client_cpu ? { client_cpu } : {}),
			...(stored.replay ? { replay: stored.replay } : {})
		};
	}

	/** The app's own browser marks for the page, per name (p50 / max over the visits). */
	#marks_for(page: string | undefined): ClientMarkStat[] | undefined {
		if (!page) return undefined;
		const by_name = this.#marks.get(page);
		if (!by_name?.size) return undefined;
		const out: ClientMarkStat[] = [];
		for (const [name, a] of by_name) {
			const ms = [...a.ms].sort((x, y) => x - y);
			out.push({
				name,
				n: ms.length,
				p50_ms: round2(percentile(ms, 0.5)),
				max_ms: round2(ms[ms.length - 1] ?? 0),
				errors: a.errors,
				attr_keys: [...a.attr_keys].sort()
			});
		}
		return out.sort((x, y) => y.p50_ms - x.p50_ms);
	}

	/** The page's web vitals as the profiler user's browser reported them (p50 over the visits). */
	#vitals_for(page: string | undefined): PageVitals | undefined {
		if (!page) return undefined;
		const e = this.#vitals.get(page);
		if (!e || !e.samples.length) return undefined;
		const p50 = (k: keyof VitalsSample) => {
			const xs = e.samples
				.map((s) => s[k])
				.filter((x): x is number => x !== undefined)
				.sort((a, b) => a - b);
			return xs.length ? round2(percentile(xs, 0.5)) : null;
		};
		return {
			n: e.samples.length,
			ttfb: p50('ttfb'),
			fcp: p50('fcp'),
			lcp: p50('lcp'),
			cls: p50('cls'),
			inp: p50('inp')
		};
	}

	/** The browser's hydration timings for THIS report's islands: the beacon ring joined by
	 *  fingerprint (the same props → the same fingerprint, so a visit after the recording matches),
	 *  then merged per island — a list of 48 cards is 48 fingerprints and one row. */
	#client_for(stored: StoredReport): ClientIslandStat[] {
		const per_entry = new Map<
			string,
			{ fp: string; name: string; ms: number[]; load: number[]; recovered: number; reason?: string }
		>();
		// (by its entry too: an island whose props change every render — a live object passed in — has
		// another fingerprint in every page view, never the profiled render's own; its entry is its own)
		const by_entry = new Map<string, BeaconAgg>();
		for (const b of this.#beacons.values())
			if (b.entry && b.ms.length) by_entry.set(entry_path(b.entry), b);
		for (const r of island_rows_of(stored.meta)) {
			const b = this.#beacons.get(r.fp) ?? by_entry.get(entry_path(r.entry));
			if (!b || !b.ms.length) continue;
			let e = per_entry.get(r.entry);
			if (!e)
				per_entry.set(r.entry, (e = { fp: r.fp, name: r.name, ms: [], load: [], recovered: 0 }));
			e.ms.push(...b.ms);
			e.load.push(...b.load);
			e.recovered += b.recovered;
			if (b.reason) e.reason = b.reason;
		}
		const out: ClientIslandStat[] = [];
		for (const [entry, e] of per_entry) {
			const ms = e.ms.sort((x, y) => x - y);
			const load = e.load.sort((x, y) => x - y);
			out.push({
				fp: e.fp,
				entry,
				name: e.name,
				n: ms.length,
				p50_ms: round2(percentile(ms, 0.5)),
				max_ms: round2(ms[ms.length - 1]),
				load_p50_ms: round2(percentile(load, 0.5)),
				recovered: e.recovered,
				...(e.reason ? { reason: e.reason } : {})
			});
		}
		return out;
	}

	/** `/replay/[id]`: profile a caught (or header-profiled) request again, in full page mode, with
	 *  the inputs it was caught with — its path and query, and the headers the trap config kept. */
	async #replay(id: string | undefined, ctx: RouteCtx): Promise<Response> {
		const stored = this.#reports.get(id ?? '');
		if (!stored?.meta.request)
			return new Response('Nothing to replay: that report has no request.', { status: 404 });
		const replay = stored.replay ?? { path: stored.meta.request.path, headers: {} };
		return this.#record_page(ctx, replay);
	}

	/** The browser's CPU profile (Chromium's JS Self-Profiling trace) → the same analysis as the
	 *  server's: components, functions, flame. Categories come from the chunk contents the build
	 *  recorded, since a client chunk's URL says nothing about what it holds. */
	async #ingest_client_cpu(
		page: string,
		trace: unknown,
		origin?: string,
		/** the slowest interaction's spans: this trace is that interaction's, not the load's */
		interaction?: { t: number; wait: [number, number]; handler: [number, number] }
	): Promise<boolean> {
		const profile = self_profile_to_cpuprofile(trace);
		if (!profile) return false;
		// THE APP'S OWN SCRIPTS BY THEIR LOCAL FILE: the browser names a frame by URL; its source map
		// sits next to the built client file. Rewriting the URL to that file (when it exists) lets the
		// server's resolver map browser frames the same way — real names for minified ones, the
		// `.svelte` file for a component. A chunk with no local file keeps its URL.
		const find = await this.#client_file_finder(origin);
		let rewritten = 0;
		if (find) {
			for (const n of profile.nodes) {
				const file = find(n.callFrame.url);
				if (file) {
					n.callFrame.url = file;
					rewritten++;
				}
			}
		}
		// THE DEV SERVER: the browser ran each module as served, named by its URL — its map is in the
		// client module graph under that URL's path (vite/dev-maps.ts), so the frame keeps the path
		if (this.dev && origin) {
			for (const n of profile.nodes) {
				const u = n.callFrame.url;
				if (u.startsWith(`${origin}/`)) {
					n.callFrame.url = u.slice(origin.length);
					rewritten++;
				}
			}
		}
		// (a build's browser chunks are mapped from the maps the build embedded, by their URL too: a
		// host whose server has no client files still names the app's functions by their source line)
		const resolver = rewritten || !this.dev ? await this.#make_resolver() : undefined;
		const url_hint = (
			url: string,
			name: string
		): FrameCategory | { category: FrameCategory; pkg?: string } | undefined => {
			let path: string;
			try {
				const u = new URL(url, 'http://x');
				path = u.pathname;
				// a script from another host (a CDN's web components, a tag manager) is a dependency,
				// whatever its function names look like — named by the package in its path, else the host
				if (origin && u.host !== 'x' && u.origin !== origin)
					return { category: 'dependency', pkg: CDN_PKG_RE.exec(path)?.[1] ?? u.host };
			} catch {
				return undefined;
			}
			// the handoff keys chunks by their served path; a rewritten local file still carries it
			const rel = app_asset_rel(path);
			if (rel) path = `/${rel}`;
			const inside = chunk_contents(path);
			if (inside) {
				if (inside.every((s) => s === 'svelte runtime')) return 'svelte';
				// a chunk with none of the app's own files in it (runtimes, packages) is a dependency,
				// whatever its minified functions are called — named by what is in it
				if (
					!inside.some((s) => s.startsWith('src/') || s.endsWith('.svelte') || s.startsWith('+'))
				) {
					const pkgs = inside
						.map((s) => s.replace(/ runtime$/, ''))
						.filter((s) => !s.startsWith('+'));
					return {
						category: 'dependency',
						pkg: pkgs.length > 2 ? `${pkgs[0]} +${pkgs.length - 1}` : pkgs.join(' + ')
					};
				}
				return undefined;
			}
			// no handoff (dev, an unknown chunk): Svelte's client runtime by its function names, so a
			// component above them is still confirmed as one
			return SVELTE_CLIENT_FN_RE.test(name) ? 'svelte' : undefined;
		};
		// a confirmed component still wearing a minified name (no map) is named from the .svelte files in its chunk
		// (by its SERVED path: a frame rewritten to its local file above still names the chunk the
		// handoff keys — `M` in og-region.<id>.js was SiteHeader all along)
		const served = (p: string) => {
			const rel = app_asset_rel(p);
			return rel ? `/${rel}` : p;
		};
		const renamer = chunk_component_renamer((p) => chunk_contents(served(p)));
		const run = (p: CpuProfile) => analyze(p, resolver, undefined, undefined, renamer, url_hint);
		// AN INTERACTION'S TRACE: only its two spans are read, and the load's analysis stays as it was
		if (interaction) {
			if (this.#interaction_cpus.size >= 50 && !this.#interaction_cpus.has(page))
				this.#interaction_cpus.delete(this.#interaction_cpus.keys().next().value!);
			this.#interaction_cpus.set(page, {
				...interaction_windows(profile, interaction, run),
				at: Date.now() // wall: stored with the report, shown as a time
			});
			return true;
		}
		const analysis = run(profile);
		// CUT BY ISLAND: the same load's visit (the trace goes out 8–20 s after the page started, the
		// visit before it) gives each island's hydrate window — what ran inside it, by name
		const visit = this.#visits.get(page)?.at(-1);
		// wall: a visit's `at` is the page's epoch time, as its beacon sent it
		const recent = visit !== undefined && Date.now() - visit.at < 120_000;
		const windows = recent ? client_windows(profile, visit, run) : undefined;
		// a slow interaction DURING the load (the load trace holds it; the interaction sampler starts
		// only once this trace is out): its spans are cut from this trace
		const i = recent ? visit.interaction : undefined;
		if (
			i &&
			i.ms >= 200 &&
			i.t * 1000 >= profile.startTime &&
			(i.t + i.ms) * 1000 <= profile.endTime
		) {
			const at = i.t + i.delay;
			if (this.#interaction_cpus.size >= 50 && !this.#interaction_cpus.has(page))
				this.#interaction_cpus.delete(this.#interaction_cpus.keys().next().value!);
			this.#interaction_cpus.set(page, {
				...interaction_windows(
					profile,
					{ t: i.t, wait: [i.t, at], handler: [at, at + i.processing] },
					run
				),
				at: Date.now() // wall: stored with the report, shown as a time
			});
		}
		if (this.#client_cpus.size >= 50 && !this.#client_cpus.has(page))
			this.#client_cpus.delete(this.#client_cpus.keys().next().value!);
		this.#client_cpus.set(page, {
			analysis,
			at: Date.now(), // wall: stored with the report, shown as a time
			sample_ms: analysis.duration_ms,
			...(windows ? { windows } : {})
		});
		return true;
	}

	/** `/beacon` (POST, authed): the runtime's hydration timings — `{ islands: [{ fp, entry, ms, load }] }`.
	 *  Bounded every way (body, islands per post, fingerprints kept, samples per fingerprint). */
	async #beacon(ctx: RouteCtx): Promise<Response> {
		let body: unknown;
		try {
			// (read no further than the largest kind; each kind's own cap is checked below)
			const raw = await read_capped(ctx.request, MAX_BEACON_CPU_BODY);
			if (raw === null) return new Response(null, { status: 413 });
			const text = new TextDecoder().decode(raw);
			// a CPU trace is the one big body (samples + stacks); a visit is a few hundred resources;
			// everything else stays small
			if (
				text.length >
				(text.includes('"cpu"')
					? MAX_BEACON_CPU_BODY
					: text.includes('"visit"')
						? MAX_BEACON_VISIT_BODY
						: MAX_BEACON_BODY)
			)
				return new Response(null, { status: 413 });
			body = JSON.parse(text);
		} catch {
			return new Response(null, { status: 400 });
		}
		const islands = (body as { islands?: unknown })?.islands;
		const visit_body = (body as { visit?: { vitals?: unknown; at?: unknown } })?.visit;
		// the vitals ride on their own message (on hide) AND inside every visit (early and final),
		// tagged with the visit's start so the later copy replaces the earlier: a browser that never
		// got to send the hide message (a tab closed hard) still reports what it measured
		const vitals =
			(body as { vitals?: unknown })?.vitals ??
			(visit_body && typeof visit_body === 'object' ? visit_body.vitals : undefined);
		const vitals_at_raw = Number(
			(body as { at?: unknown })?.at ??
				(visit_body && typeof visit_body === 'object' ? visit_body.at : undefined)
		);
		const vitals_at =
			Number.isFinite(vitals_at_raw) && vitals_at_raw > 0 ? Math.round(vitals_at_raw) : undefined;
		const marks = (body as { marks?: unknown })?.marks;
		const cpu = (body as { cpu?: unknown })?.cpu;
		const page = (body as { page?: unknown })?.page;
		const visit_raw = (body as { visit?: unknown })?.visit;
		if (
			!Array.isArray(islands) &&
			!(vitals && typeof vitals === 'object') &&
			!Array.isArray(marks) &&
			!(cpu && typeof cpu === 'object') &&
			!(visit_raw && typeof visit_raw === 'object')
		)
			return new Response(null, { status: 400 });
		// THE VISIT: the browser's whole picture of one page load, a few kept per page
		if (visit_raw && typeof visit_raw === 'object') {
			const visit = parse_visit(page, visit_raw);
			if (!visit) return new Response(null, { status: 400 });
			let list = this.#visits.get(visit.page);
			if (!list) {
				if (this.#visits.size >= MAX_VITALS_PATHS)
					this.#visits.delete(this.#visits.keys().next().value!);
				this.#visits.set(visit.page, (list = []));
			}
			// the same visit again (its other half, or its final post): fold, don't append
			const same = list.findIndex((v) => v.at === visit.at);
			if (same !== -1) list[same] = merge_visits(list[same], visit);
			else {
				list.push(visit);
				if (list.length > MAX_VISITS_PER_PAGE) list.shift();
			}
		}
		if (
			cpu &&
			typeof cpu === 'object' &&
			typeof page === 'string' &&
			page.startsWith('/') &&
			page.length <= 500 &&
			this.#client_cpu
		) {
			// (an interaction's trace carries its spans: two numbers each, on the page's clock)
			const it = (body as { interaction?: { t?: unknown; wait?: unknown; handler?: unknown } })
				?.interaction;
			const pair = (v: unknown): [number, number] | null =>
				Array.isArray(v) &&
				v.length === 2 &&
				v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 3_600_000) &&
				v[1] >= v[0]
					? [v[0], v[1]]
					: null;
			const wait = pair(it?.wait);
			const handler = pair(it?.handler);
			const spans =
				it && typeof it.t === 'number' && Number.isFinite(it.t) && wait && handler
					? { t: it.t, wait, handler }
					: undefined;
			if (it && !spans) return new Response(null, { status: 400 });
			if (!(await this.#ingest_client_cpu(page, cpu, ctx.url.origin, spans)))
				return new Response(null, { status: 400 });
		}
		const now = clock.mono();
		// THE APP'S MARKS (`mark()` from ogygia/profiler/client): per page, per name, bounded
		if (
			Array.isArray(marks) &&
			typeof page === 'string' &&
			page.startsWith('/') &&
			page.length <= 500
		) {
			let by_name = this.#marks.get(page);
			if (!by_name) {
				if (this.#marks.size >= MAX_VITALS_PATHS)
					this.#marks.delete(this.#marks.keys().next().value!);
				this.#marks.set(page, (by_name = new Map()));
			}
			for (const m of marks.slice(0, MAX_BEACON_ISLANDS)) {
				const name = typeof m?.name === 'string' ? m.name.slice(0, 120) : '';
				const ms = Number(m?.ms);
				if (!name || !Number.isFinite(ms) || ms < 0 || ms > 600_000) continue;
				let agg = by_name.get(name);
				if (!agg) {
					if (by_name.size >= 100) continue;
					by_name.set(name, (agg = { ms: [], errors: 0, attr_keys: new Set() }));
				}
				agg.ms.push(round2(ms));
				if (agg.ms.length > MAX_BEACON_SAMPLES) agg.ms.shift();
				const attrs =
					m?.attrs && typeof m.attrs === 'object' ? (m.attrs as Record<string, unknown>) : null;
				if (attrs?.error === true) agg.errors++;
				for (const k of Object.keys(attrs ?? {}).slice(0, 12))
					if (k !== 'error') agg.attr_keys.add(k.slice(0, 40));
			}
		}
		// WEB VITALS for the page: what this visit's browser measured, kept per path
		if (
			vitals &&
			typeof vitals === 'object' &&
			typeof page === 'string' &&
			page.startsWith('/') &&
			page.length <= 500
		) {
			const v = vitals as Record<string, unknown>;
			const num = (k: string, max: number) => {
				const n = Number(v[k]);
				return Number.isFinite(n) && n >= 0 && n <= max ? round2(n) : undefined;
			};
			const sample: VitalsSample = vitals_at !== undefined ? { at: vitals_at } : {};
			const ttfb = num('ttfb', 600_000);
			const fcp = num('fcp', 600_000);
			const lcp = num('lcp', 600_000);
			const cls = num('cls', 100);
			const inp = num('inp', 600_000);
			if (ttfb !== undefined) sample.ttfb = ttfb;
			if (fcp !== undefined) sample.fcp = fcp;
			if (lcp !== undefined) sample.lcp = lcp;
			if (cls !== undefined) sample.cls = cls;
			if (inp !== undefined) sample.inp = inp;
			if (Object.keys(sample).some((k) => k !== 'at')) {
				let e = this.#vitals.get(page);
				if (!e) {
					if (this.#vitals.size >= MAX_VITALS_PATHS) {
						let oldest: string | undefined;
						let t = Infinity;
						for (const [k, x] of this.#vitals)
							if (x.last < t) {
								t = x.last;
								oldest = k;
							}
						if (oldest !== undefined) this.#vitals.delete(oldest);
					}
					this.#vitals.set(page, (e = { samples: [], last: now }));
				}
				e.last = now;
				const same = sample.at !== undefined ? e.samples.findIndex((s) => s.at === sample.at) : -1;
				if (same !== -1) e.samples[same] = { ...e.samples[same], ...sample };
				else e.samples.push(sample);
				if (e.samples.length > MAX_VITALS_SAMPLES) e.samples.shift();
			}
		}
		for (const it of Array.isArray(islands) ? islands.slice(0, MAX_BEACON_ISLANDS) : []) {
			const fp = typeof it?.fp === 'string' ? it.fp : '';
			const ms = Number(it?.ms);
			const load = Number(it?.load);
			if (!is_hex_id(fp) || !Number.isFinite(ms) || ms < 0 || ms > 600_000) continue;
			let agg = this.#beacons.get(fp);
			if (!agg) {
				if (this.#beacons.size >= MAX_BEACON_FPS) {
					// drop the stalest fingerprint
					let oldest: string | undefined;
					let t = Infinity;
					for (const [k, v] of this.#beacons)
						if (v.last < t) {
							t = v.last;
							oldest = k;
						}
					if (oldest !== undefined) this.#beacons.delete(oldest);
				}
				this.#beacons.set(
					fp,
					(agg = {
						entry: typeof it?.entry === 'string' ? it.entry.slice(0, 300) : '',
						ms: [],
						load: [],
						recovered: 0,
						last: now
					})
				);
			}
			agg.last = now;
			if (it?.recovered === true) agg.recovered++;
			if (typeof it?.reason === 'string' && it.reason) agg.reason = it.reason.slice(0, 300);
			agg.ms.push(round2(ms));
			agg.load.push(Number.isFinite(load) && load >= 0 ? round2(Math.min(load, ms)) : 0);
			if (agg.ms.length > MAX_BEACON_SAMPLES) {
				agg.ms.shift();
				agg.load.shift();
			}
		}
		return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
	}

	/** The page the profiler's own user is about to view gets the beacon tag: the runtime posts its
	 *  hydration timings to `/beacon` when it sees it, and does nothing otherwise. The flag cookie
	 *  (set at login, site-wide, no secret) or the key header says it is that user; dev is open. The
	 *  tag goes at the end of `<head>` so the runtime bootstrap stays the first script. A visitor
	 *  never sees it; a stray flag with no session posts to a guarded route and gets nothing. */
	async #beacon_tag(event: RequestEvent): Promise<string | null> {
		if (!this.ui_enabled) return null;
		// (never in the profiler's own renders: they ask as a page navigation, and the tag is not the page's)
		if (event.request.headers.get('x-og-profiler-internal') === '1') return null;
		if (!is_document_request(event.request)) return null;
		if (!this.dev) {
			const key = event.request.headers.get('x-profiler-key');
			if (key ? !(await this.#key_ok(key, event)) : !(await this.#flag_ok(event))) return null;
		}
		return `<meta name="${BEACON_META}" content="${this.base}/beacon">${BEACON_STANDALONE_TAG}`;
	}

	// ---- the handle -------------------------------------------------------
	handle: Handle = async ({ event, resolve }) => {
		if (this.#disabled) return resolve(event);
		// the instance's first request, on the process clock (0 = the process started): on AWS Lambda
		// an instance starts FOR a request, so this is its cold start (Node, the server bundle and its
		// imports, the hand-over); a report recorded on this instance says so
		this.#first_request_pt ??= performance.now();
		this.#requests_seen++;
		await this.#init();

		const on_ui_path =
			event.url.pathname === this.base || event.url.pathname.startsWith(`${this.base}/`);
		if (this.ui_enabled && on_ui_path) {
			return this.#ui(event);
		}
		// Enabled by config but NO secret set in production → the UI is off. Someone still hit the UI
		// path; OWN the response with a clear 404 instead of falling through — otherwise the app's own
		// routing (e.g. an i18n catch-all) can silently redirect `/__profiler` to the home page, which
		// looks like the profiler is broken. This tells the developer exactly what to set.
		if (!this.#disabled && !this.ui_enabled && !this.dev && this.secret === '' && on_ui_path) {
			return new Response(
				`ogygia profiler is installed but disabled: set OGYGIA_PROFILER_SECRET (or \`ogygia({ profiler: { secret } })\`) to enable the UI in production.`,
				{
					status: 404,
					headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
				}
			);
		}

		// A REMOTE FUNCTION CALL: Kit's `url` is the page that asked (a header), `/` when none did (a
		// server render reading a `prerender` function's answer over HTTP): its own address is the request's
		const remote = (event as { isRemoteRequest?: boolean }).isRemoteRequest === true;
		let remote_url: URL | null = null;
		if (remote)
			try {
				remote_url = new URL(event.request.url);
			} catch {
				remote_url = null;
			}
		const entry: RequestEntry = {
			ts: Date.now(), // wall: a request's time, shown and stored
			method: event.request.method,
			path: remote_url ? remote_url.pathname : event.url.pathname,
			...(remote ? { remote: true as const } : {}),
			route: event.route?.id ?? null,
			status: 0,
			ms: 0,
			cpu_ms: 0,
			inflight: this.#inflight,
			net_ms: 0,
			net_count: 0,
			internal: event.request.headers.get('x-og-profiler-internal') === '1' || undefined
		};
		// the query, for a replay — Kit THROWS on `url.search` while prerendering, so read it guarded
		try {
			const search = remote_url ? remote_url.search : event.url.search;
			if (search) entry.search = search;
		} catch {
			// ok: prerendering: no query to keep
		}
		// the inputs a caught request is replayed with: only the headers the trap config names
		if (this.#trap?.replay?.length) {
			const kept: Record<string, string> = {};
			for (const h of this.#trap.replay) {
				const v = event.request.headers.get(h);
				if (v !== null) kept[h.toLowerCase()] = v.slice(0, 2048);
			}
			if (Object.keys(kept).length) entry.replay_headers = kept;
		}

		// Header-triggered single-request profile? Decided FIRST, because it is one of the three
		// reasons a request gets a network-attribution context at all.
		const profile_header = event.request.headers.get('x-profile');
		const key_ok =
			!!profile_header && this.ui_enabled && (await this.#key_ok(profile_header, event));
		// Take the recorder slot atomically (no await between the check and the take): two concurrent
		// header-profiled requests must not both start a recording and collide on the one process-wide
		// inspector. If it's busy, this request just renders un-profiled rather than waiting.
		const header_token = key_ok ? this.#take('recording') : null;
		const header_profile = header_token !== null;

		// PAY ONLY WHEN PROFILING. Attributing outbound calls to a request means running it inside
		// an AsyncLocalStorage, and on Node 20 every ALS in flight costs a store copy per async hop —
		// a page with 475k hops paid ~0.2 s to this one ALS while nothing was being recorded. So in
		// production the context exists only while a profile is actually being taken (a page-mode
		// recording, or this request's own header profile); an idle request is wall time + CPU usage
		// and nothing else. Dev keeps it always on: Server-Timing's outbound breakdown is a dev tool,
		// and dev latency is nobody's metric.
		// (a background window — the trap, the sampler — never opens a per-request context: the
		// request is matched to the window by time instead, so the site pays the sampler only)
		const attribute = !!this.#als && (this.dev || this.#recording_active() || header_profile);
		const ctx: Ctx | null = attribute
			? this.#request_ctx(entry, request_scope(event.request))
			: null;
		// THE KEEP-THE-ANSWERS RENDER: the profiler's own render, marked with this recording's token,
		// is served the kept answers for the calls that answered the same in every timed render
		const answers = this.#answers;
		if (
			ctx &&
			answers &&
			this.#kept &&
			event.request.headers.get(ANSWERS_HEADER) === answers.token
		) {
			const kept = this.#kept;
			ctx.answer = (method, url) => {
				const key = `${method} ${url}`;
				return answers.keys.has(key) ? kept.get(key) : undefined;
			};
		}

		const start = performance.now();
		entry.pt = start; // the perf clock: what a trap window matches the request's timeline on
		const cpu0 = process.cpuUsage();
		this.#inflight++;

		// Kit's `event.fetch` answers a same-origin call in-process, past the global fetch patch: a
		// load calling its own API is a wait the profiler would not see. Wrap it while attributing
		// (one closure per attributed request; nothing on an idle request).
		if (ctx && this.#wrap_event_fetch && typeof event.fetch === 'function') {
			try {
				// (SvelteKit 3 types `fetch` as readonly; at runtime it is a plain property on 2 and 3)
				(event as { fetch: typeof fetch }).fetch = this.#wrap_event_fetch(event.fetch);
			} catch {
				// ok: a frozen event (a test double); the global patch still covers real HTTP
			}
		}
		const beacon_tag = await this.#beacon_tag(event);
		const resolve_page = () =>
			beacon_tag
				? resolve(event, {
						transformPageChunk: ({ html }) => {
							const at = head_end(html);
							return at === -1 ? html : html.slice(0, at) + beacon_tag + html.slice(at);
						}
					})
				: resolve(event);
		const run = async (): Promise<Response> => {
			const res = ctx && this.#als ? await this.#als.run(ctx, resolve_page) : await resolve_page();
			entry.status = res.status;
			// the profiler's own user gets the JS Self-Profiling policy: the runtime can then sample the
			// main thread while the page hydrates and beacon the trace (never a visitor: no tag, no policy)
			if (beacon_tag && this.#client_cpu) {
				try {
					res.headers.set('document-policy', 'js-profiling');
				} catch {
					// ok: immutable headers; the response goes as it is
				}
			}
			// (the beacon is this user's: no shared cache may keep the page that carries it)
			if (beacon_tag && !this.dev) mark_personal(res);
			if (this.want_server_timing) {
				try {
					const ms = performance.now() - start;
					res.headers.append('Server-Timing', `ssr;desc="SvelteKit render";dur=${ms.toFixed(1)}`);
					// the CPU this request used (the rest of `ssr` is waiting), for the devtools Record tab
					try {
						const c = process.cpuUsage(cpu0);
						// (process-wide: a request running beside others reads their CPU too)
						res.headers.append(
							'Server-Timing',
							`cpu;desc="process CPU while it ran";dur=${((c.user + c.system) / 1000).toFixed(1)}`
						);
					} catch {
						// ok: no cpuUsage on this runtime: no CPU timing
					}
					if (ctx?.net.length) {
						const net_ms = ctx.net.reduce((a, c) => a + Math.max(c.ms, 0) + (c.body_ms ?? 0), 0);
						res.headers.append(
							'Server-Timing',
							`net;desc="outbound (${ctx.net.length})";dur=${net_ms.toFixed(1)}`
						);
						// the slowest outbound calls by name (`up1`…`up3`): the browser shows which upstream a
						// slow request waited on (no query strings: they can carry tokens)
						const top = [...ctx.net]
							.sort((x, y) => y.ms + (y.body_ms ?? 0) - (x.ms + (x.body_ms ?? 0)))
							.slice(0, 3);
						top.forEach((x, i) => {
							// host + path only, relative or absolute (a query can carry a token)
							let where = x.url.split('?')[0].split('#')[0];
							try {
								const u = new URL(x.url, 'http://relative.invalid');
								where = (u.host === 'relative.invalid' ? '' : u.host) + u.pathname;
							} catch {
								// ok: not a URL: the stripped string is kept
							}
							const desc = `${x.method ?? 'GET'} ${where}`
								.slice(0, 120)
								.split('"')
								.join("'")
								.split('\\')
								.join('/');
							res.headers.append(
								'Server-Timing',
								`up${i + 1};desc="${desc}";dur=${(Math.max(x.ms, 0) + (x.body_ms ?? 0)).toFixed(1)}`
							);
						});
					}
					// NESTED TRACE: a profiler upstream of us is recording and asked — answer with our
					// picture of this request (same exposure policy as Server-Timing)
					if (event.request.headers.get(TRACE_HEADER)) {
						const c = process.cpuUsage(cpu0);
						const net = ctx?.net ?? [];
						res.headers.set(
							TRACE_HEADER,
							encode_trace({
								ms: round2(ms),
								cpu_ms: round2((c.user + c.system) / 1000),
								wait_ms: round2(net.reduce((a, x) => a + Math.max(x.ms, 0) + (x.body_ms ?? 0), 0)),
								calls: net.length,
								route: event.route?.id ?? null,
								top: [...net]
									.sort((x, y) => y.ms - x.ms)
									.slice(0, 5)
									.map((x) => ({ url: x.url.slice(0, 200), ms: round2(x.ms + (x.body_ms ?? 0)) })),
								profiler: this.base
							})
						);
					}
				} catch {
					// ok: immutable headers (a cached Response); the timing header is left out
				}
			}
			return res;
		};

		// header-triggered single-request profile (decided above)
		// (cut at the hard cap like a page recording, should this request wedge inside the capture)
		if (header_token !== null) {
			try {
				let res: Response | undefined;
				const cap = await this.#capture_window(100, async () => {
					res = await run();
				});
				this.#finalize(entry, start, cpu0, ctx, event.request);
				cap.window = { start, end: start + entry.ms };
				const id = await this.#finish_report(cap, {
					trigger: 'request',
					request: { method: entry.method, path: entry.path, route: entry.route, ms: entry.ms }
				});
				// the inputs a replay renders with: the path + query, and the headers the trap config keeps
				const stored = this.#reports.get(id);
				if (stored)
					stored.replay = {
						path: entry.path + (entry.search ?? ''),
						headers: entry.replay_headers ?? {}
					};
				try {
					res?.headers.append('x-profile-report', `${this.base}/report/${id}`);
				} catch {
					// ok: immutable headers; the response goes as it is
				}
				return res!;
			} finally {
				this.#free(header_token);
			}
		}

		try {
			return await run();
		} finally {
			this.#finalize(entry, start, cpu0, ctx, event.request);
			// a test's window across instances: this request in the store before the answer goes out
			if (event.request.headers.has(WINDOW_HEADER)) await this.#window_note(entry, event.request);
		}
	};

	#finalize(
		entry: RequestEntry,
		start: number,
		cpu0: NodeJS.CpuUsage,
		ctx: Ctx | null,
		request?: Request
	): void {
		this.#inflight--;
		entry.ms = round2(performance.now() - start);
		const c = process.cpuUsage(cpu0);
		entry.cpu_ms = round2((c.user + c.system) / 1000);
		// what ogygia's handle added to this page (seed / props bytes, transform ms) — recorded by
		// hooks.ts on the request, read back here so the log and the report can show ogygia's own cost
		const og = request ? request_stats_of(request) : undefined;
		if (og) entry.og = og;
		const hole = request ? hole_stats_of(request) : undefined;
		if (hole) entry.hole = hole;
		if (ctx) {
			entry.net_count = ctx.net.length;
			entry.net_ms = round2(ctx.net.reduce((a, c) => a + Math.max(c.ms, 0) + (c.body_ms ?? 0), 0));
			if (ctx.spans.length) {
				entry.span_count = ctx.spans.length;
				// top-level spans only: a nested span's time is inside its parent's
				entry.span_ms = round2(
					ctx.spans.filter((s) => s.parent === undefined && s.ms >= 0).reduce((a, s) => a + s.ms, 0)
				);
			}
		}
		this.#ring.push(entry);
		if (this.#ring.length > this.ring_size) this.#ring.shift();
		if (request) {
			this.#logged.set(request, entry);
			const early = this.#early_holes.get(request);
			if (early) {
				this.#early_holes.delete(request);
				for (const s of early) this.#batch_hole(request, s);
			}
		}
		if (this.#sink_url && !entry.internal) {
			this.#sink.push({
				k: 'req',
				t: entry.ts,
				path: entry.path,
				route: entry.route,
				ms: entry.ms,
				cpu: entry.cpu_ms,
				wait: entry.net_ms,
				status: entry.status,
				...(entry.og ? { og: entry.og.seed_bytes + entry.og.tail_bytes } : {})
			});
			// serverless: this instance may be frozen after the response — post now, best effort
			if (Number.isFinite(serverless_work_budget_ms())) void this.#sink_flush(); // ok: a flush never rejects (its failure is kept for the site view)
		}
	}

	// ── the sink ─────────────────────────────────────────────────────────────────────────────
	/** Hand the buffered rows to the sink's outbox as one post, now. While a post is out, the rows
	 *  wait in the buffer (capped: it drops the oldest when full) and go in one post once it ends,
	 *  never a post per tick queued behind a sink that is down (#376). Settles once the rows asked
	 *  for were taken or given up; never rejects. */
	#sink_flush(): Promise<void> {
		// (a superseded profiler sends what it holds this once, then its timer stops)
		if (this.#sink_timer && this.#superseded()) {
			this.#sink_timer();
			this.#sink_timer = null;
		}
		const out = this.#sink_out;
		if (out !== null) {
			out.again = true;
			return out.done;
		}
		if (!this.#sink_url || !this.#sink.size) return Promise.resolve();
		const rows = this.#sink.size;
		const post: SinkPost = {
			id: `${this.#sink_run}-${++this.#sink_count}`,
			body: this.#sink.drain(),
			rows
		};
		const posting: SinkOut = { again: false, done: Promise.resolve() };
		this.#sink_out = posting;
		posting.done = this.#sink_posts.put(post).then(() => {
			this.#sink_out = null;
			// (rows read while it was out, asked for meanwhile: the next post)
			if (posting.again) return this.#sink_flush();
		});
		return posting.done;
	}
	/** The post out now, and whether a flush asked for the rows read meanwhile. */
	#sink_out: SinkOut | null = null;

	/** Each post's id: this profiler's run, and its count. */
	readonly #sink_run = Math.random().toString(36).slice(2, 10);
	#sink_count = 0;

	/** One try at a post: done once the sink answered ok. Its id rides `idempotency-key`, so a sink
	 *  that saw it already (an answer lost on the way back) can drop the copy. */
	async #sink_post(post: SinkPost, signal: AbortSignal): Promise<void> {
		try {
			const res = await fetch(this.#sink_url!, {
				method: 'POST',
				body: post.body,
				headers: {
					'content-type': 'application/x-ndjson',
					'idempotency-key': post.id,
					'x-og-profiler-internal': '1',
					...(this.#sink_key ? { authorization: `Bearer ${this.#sink_key}` } : {})
				},
				signal: AbortSignal.any([signal, AbortSignal.timeout(SINK_TRY_MS)])
			});
			if (!res.ok) throw new Error(`the sink answered ${res.status}`);
			this.#sink_last = { at: Date.now(), ok: true, rows: post.rows }; // wall: shown as a time
		} catch (error) {
			// wall: shown as a time
			this.#sink_last = { at: Date.now(), ok: false, rows: post.rows, error: error_text(error) };
			throw error;
		}
	}

	/** The site view's rows from THIS instance: the request ring and the sampler's windows — what a
	 *  long-lived host has without a sink. */
	#site_rows(): SinkRow[] {
		const rows: SinkRow[] = [];
		for (const e of this.#ring)
			if (!e.internal)
				rows.push({
					k: 'req',
					t: e.ts,
					path: e.path,
					route: e.route,
					ms: e.ms,
					cpu: e.cpu_ms,
					wait: e.net_ms,
					status: e.status,
					...(e.og ? { og: e.og.seed_bytes + e.og.tail_bytes } : {})
				});
		for (const w of this.#sampled)
			rows.push({
				k: 'win',
				t0: w.at,
				t1: w.at + w.ms,
				fns: w.functions
					.slice(0, 40)
					.map((f) => ({ name: f.name, file: f.url, self_ms: f.self_ms, category: f.category }))
			});
		for (const r of this.#reports.values())
			if (r.meta.trigger === 'trap' && r.meta.request)
				rows.push({
					k: 'trap',
					t: r.meta.created,
					path: r.meta.request.path,
					ms: r.meta.request.ms,
					id: r.meta.id
				});
		return rows;
	}

	/** `/site`: the whole-site pictures (the request cloud, the layer cake) from this instance's
	 *  rows, or from a sink the browser reads (`?from=<url>`, or the configured sink). */
	#site(ctx: RouteCtx) {
		const from = ctx.url.searchParams.get('from');
		return {
			base: this.base,
			rows: this.#site_rows(),
			sink: this.#sink_url
				? { url: this.#sink_url, last: this.#sink_last, buffered: this.#sink.size }
				: null,
			from: from && /^https?:\/\//.test(from) ? from.slice(0, 2000) : null,
			ephemeral: Number.isFinite(serverless_work_budget_ms())
		};
	}
}

/**
 * Build a profiler handle. INTERNAL — the profiler is configured in vite.config.ts
 * (`ogygia({ profiler: true })`) and `ogygia.handle()` constructs + mounts this itself.
 * Kept as a named export only so the handle's lazy import can reach it; it is not a
 * public entry point.
 *
 * See the class doc and README for what it captures. Visit `<path>` (default
 * /__profiler) — in prod, log in (or send the x-profiler-key header).
 */
export function profiler(options: ProfilerOptions = {}): ProfilerHandle {
	const instance = new Profiler(options);
	return Object.assign((args: Parameters<Handle>[0]) => instance.handle(args), {
		measures: (event: RequestEvent) => instance.measures(event)
	});
}

/** The profiler's handle, and the shared `measures` hook's answer (../server.ts). */
export type ProfilerHandle = Handle & { measures(event: RequestEvent): Promise<boolean> };

// ---------------------------------------------------------------------------

function route_aggregates(ring: RequestEntry[], by: string | null = null): RouteAgg[] {
	const by_route = new Map<string, RequestEntry[]>();
	for (const e of ring) {
		if (e.internal) continue;
		// split by a request tag (`tag('tenant', …)`): one row per route × value
		const key = (e.route ?? '(no route)') + (by ? ` · ${by}=${e.tags?.[by] ?? '—'}` : '');
		let list = by_route.get(key);
		if (!list) by_route.set(key, (list = []));
		list.push(e);
	}
	const aggs: RouteAgg[] = [];
	for (const [route, list] of by_route) {
		const sorted = list.map((e) => e.ms).sort((a, b) => a - b);
		const net = list.map((e) => e.net_ms).sort((a, b) => a - b);
		aggs.push({
			route,
			count: list.length,
			p50: pct(sorted, 50),
			p95: pct(sorted, 95),
			max: sorted.at(-1) ?? 0,
			avg: round2(sorted.reduce((a, c) => a + c, 0) / (sorted.length || 1)),
			net_p50: pct(net, 50)
		});
	}
	return aggs.sort((a, b) => b.p95 - a.p95);
}

function pct(sorted: number[], p: number): number {
	if (!sorted.length) return 0;
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

/** Race a promise against a wall-time so a hung render can never pin a recording (and, through the
 *  attribution AsyncLocalStorage, the whole site). Rejects with `label` on timeout; the underlying work
 *  is left to settle on its own — the caller has already moved on. */
function with_timeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	if (!Number.isFinite(ms) || ms <= 0) return p;
	// (the race's own timer: it goes the moment `p` settles)
	const race = scope();
	const timeout = new Promise<never>((_, reject) =>
		race.timeout(() => reject(new Error(label)), Math.min(ms, 2_147_483_647))
	);
	return Promise.race([p.finally(() => race.close()), timeout]);
}

/** Settles after `ms`, or at once when `owner` ends (its timer goes with it). */
function pause(owner: Scope, ms: number): Promise<unknown> {
	return owner.task(() => new Promise<void>((r) => owner.timeout(r, ms)));
}

/** OGYGIA_PROFILER_DEBUG: the process's memory at a step of a recording (what the profiler itself
 *  holds on a small serverless instance) */
function mem_mark(step: string): void {
	if (!process.env.OGYGIA_PROFILER_DEBUG) return;
	const m = process.memoryUsage();
	const mb = (n: number) => Math.round(n / 1048576);
	console.error(
		`[ogygia/profiler] memory ${step} @${Math.round(performance.now())} ms: rss ${mb(m.rss)} heap ${mb(m.heapUsed)} external ${mb(m.external)} buffers ${mb(m.arrayBuffers)} MB`
	);
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** What names a report: kept whatever `fields` asks for. */
const REPORT_IDENTITY = ['schema', 'version', 'engine', 'kind', 'id', 'created', 'target', 'links'];

/** `report` with only the top-level keys in `fields` (comma-separated) and its identity; whole when unset. */
export function pick_fields(
	report: Record<string, unknown>,
	fields: string | null
): Record<string, unknown> {
	if (!fields) return report;
	const want = new Set([
		...REPORT_IDENTITY,
		...fields
			.split(',')
			.map((f) => f.trim())
			.filter(Boolean)
	]);
	const out: Record<string, unknown> = {};
	for (const k in report) if (want.has(k)) out[k] = report[k];
	return out;
}

/**
 * The module (src-relative, no extension: `lib/inferno/catalog`) a file imports `name` from — its
 * `import { name } from '$lib/…'` or `'./…'` — or the file itself when it declares it. Undefined for
 * a package import, or a name it cannot place. Plain text, no regex.
 */
/**
 * Is the route in `dir` prerendered? Kit takes the NEAREST `export const prerender`: the page's own
 * files first (`+page.server`, `+page`), then each layout up the tree. `true` and `'auto'` prerender;
 * `false` (or none found) does not. String search over the files (no regex, no parse).
 */
export function route_prerendered(
	read: (file: string) => string | undefined,
	dir: string
): boolean {
	let at = dir;
	let first = true;
	while (at) {
		const names = [
			...(first ? ['+page.server.ts', '+page.server.js', '+page.ts', '+page.js'] : []),
			'+layout.server.ts',
			'+layout.server.js',
			'+layout.ts',
			'+layout.js'
		];
		for (const n of names) {
			const src = read(`${at}/${n}`);
			if (!src) continue;
			const k = src.indexOf('export const prerender');
			if (k === -1) continue;
			const eq = src.indexOf('=', k);
			const v = eq === -1 ? '' : src.slice(eq + 1, eq + 12).trim();
			return v.startsWith('true') || v.startsWith("'auto'") || v.startsWith('"auto"');
		}
		first = false;
		const up = at.lastIndexOf('/');
		if (up === -1) break;
		at = at.slice(0, up);
	}
	return false;
}

/** An island entry as a path, however it was written (`./_app/x.js`, `/_app/x.js`, an absolute URL). */
function entry_path(entry: string): string {
	try {
		return new URL(entry, 'http://x/').pathname;
	} catch {
		return entry;
	}
}

function imported_from(src: string, name: string, file: string): string | undefined {
	const self = file.slice(0, file.lastIndexOf('.'));
	for (const line of src.split('\n')) {
		const l = line.trim();
		if (!l.startsWith('import')) {
			if (
				(l.startsWith(`function ${name}(`) ||
					l.startsWith(`export function ${name}(`) ||
					l.startsWith(`async function ${name}(`) ||
					l.startsWith(`export async function ${name}(`) ||
					l.startsWith(`const ${name} =`)) &&
				!l.startsWith('import')
			)
				return self;
			continue;
		}
		const open = l.indexOf('{');
		const close = l.indexOf('}');
		const names =
			open !== -1 && close > open
				? l
						.slice(open + 1, close)
						.split(',')
						.map((x) => x.trim().split(' as ').pop()!.trim())
				: [];
		if (!names.includes(name)) continue;
		const q = Math.max(l.lastIndexOf("'"), l.lastIndexOf('"'));
		const q0 = Math.max(l.lastIndexOf("'", q - 1), l.lastIndexOf('"', q - 1));
		const spec = q0 !== -1 && q > q0 ? l.slice(q0 + 1, q) : '';
		const bare = (p: string) => (p.endsWith('.ts') || p.endsWith('.js') ? p.slice(0, -3) : p);
		if (spec.startsWith('$lib/')) return bare(`lib/${spec.slice(5)}`);
		if (spec.startsWith('.')) {
			const parts = file.split('/').slice(0, -1);
			for (const seg of spec.split('/')) {
				if (seg === '..') parts.pop();
				else if (seg !== '.') parts.push(seg);
			}
			return bare(parts.join('/'));
		}
		return undefined;
	}
	return undefined;
}

export type { Analysis, CpuProfile, HeapAllocator } from './analyze.ts';
export type { NetCall } from './net.ts';
export type { ReportMeta, RequestEntry } from './report.ts';
