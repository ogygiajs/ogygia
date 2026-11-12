/**
 * The SERVER half of `devtools()` (its `server`). With the profiler on it
 * wraps every request (`handle`): it times the render and serves its UI at `/__profiler`, and turns
 * on core's request stats, its data. The profiler itself — node:inspector, crypto, the UI's render
 * path — loads on the first request through a dynamic import, so an app pays for it only when it is
 * on; with `onDemand`, only once someone opens the profiler.
 */
import {
	defineServer,
	type ResolveOptions,
	type ServerApp,
	type ServerPlugin
} from '@ogygia/core/plugin';
import type { RequestEvent } from '@sveltejs/kit';
import { DEVTOOLS_COOKIE, DEVTOOLS_ON, switch_in_url } from '@ogygia/core/internal/instruments';
import { BEACON_STANDALONE_TAG } from './profiler/beacon-tag.ts';
import { is_document_request } from './document-request.ts';
import { set_devtools_app } from './app.ts';
import { install_request_stats } from './profiler/request-stats.ts';
import { flights, say, STALE } from '@ogygia/machine';
import type { ProfilerHandle, ProfilerOptions } from './profiler/index.ts';
import { profiler_demand_skip } from './profiler/on-demand.ts';
import { OgygiaError } from './messages/runtime.ts';

/** What `devtools()` hands its server half (vite.config → `ogygia:server/server-plugins`). The
 *  profiler's `secret` is here only when the app passed one (then it IS baked into the server build,
 *  on purpose — a serverless host may have no runtime env); left out, the profiler reads
 *  OGYGIA_PROFILER_SECRET at runtime. */
export interface DevtoolsServerOptions {
	profiler: ProfilerOptions | null;
}

/** the mounted profiler, once a mount succeeded */
let mounted: ProfilerHandle | null = null;

/** The process's one profiler mount: the first requests that arrive together share it. A mount
 *  that fails (an edge runtime without node:inspector, a dev server mid-edit) is not kept, so the
 *  next request tries again. */
const mounting = flights.keyed<{ options: ProfilerOptions }>()({
	name: 'profiler mount',
	key: [],
	ignore: {
		options: "one mount for the process: the first request's options are the ones it mounts with"
	},
	run: async ({ options }) => {
		const { profiler } = await import('./profiler/index.ts');
		// a runtime store (`setProfilerStore` in hooks.server.ts): a live DB object the build-time options
		// could not carry, merged over them
		const { getProfilerStore } = await import('./profiler/storage/index.ts').catch(() => ({
			getProfilerStore: () => undefined
		}));
		const store = getProfilerStore();
		return (mounted = profiler({ ...options, ...(store ? { store } : {}) }));
	}
});

/** a failed mount was said (once for the process: an edge runtime fails every request the same way) */
const mount_failure = say({ max: 1 });

async function mount(options: ProfilerOptions): Promise<ProfilerHandle | null> {
	// (nothing drops the mount, so it is never STALE)
	return mounting.get({ options }).then(
		(m) => (m === STALE ? null : m),
		(error: unknown) => {
			mount_failure.once('mount', () =>
				console.error(new OgygiaError('devtools_profiler_mount_failed'), error)
			);
			return null;
		}
	);
}

const DOCK = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const DOCK_LAZY =
	typeof __OGYGIA_DEVTOOLS_LAZY__ !== 'undefined' ? __OGYGIA_DEVTOOLS_LAZY__ : false;

/** A document request from a browser the dock measures: every one in dev, in a build one that turned
 *  the devtools on (this very request may turn it on). */
function dock_measures(event: RequestEvent): boolean {
	if (!DOCK || !is_document_request(event.request)) return false;
	if (!DOCK_LAZY) return true;
	return switch_in_url(event.url) ?? event.cookies.get(DEVTOOLS_COOKIE) === DEVTOOLS_ON;
}

/** The page beacon in the document's head, once: a profiler that put it there already is left so. */
const WITH_PAGE_BEACON: ResolveOptions = {
	transformPageChunk: ({ html }) => {
		const at = html.indexOf('</head>');
		if (at === -1 || html.lastIndexOf('<script data-ogygia-beacon>', at) !== -1) return html;
		return `${html.slice(0, at)}${BEACON_STANDALONE_TAG}${html.slice(at)}`;
	}
};

/** `res`, never kept by a shared cache: in a build, the beacon is in the documents of one browser
 *  that switched devtools on (a cookie or `?devtools=on`, which no `Vary` can key). */
function never_stored(res: Response): Response {
	try {
		res.headers.set('cache-control', 'private, no-store');
		return res;
	} catch {
		// ok: immutable headers (a fetched response passed through): the same response, new headers
		const headers = new Headers(res.headers);
		headers.set('cache-control', 'private, no-store');
		return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
	}
}

/** `outer`'s page transform after `inner`'s, the other options merged. */
function after(inner: ResolveOptions | undefined, outer: ResolveOptions): ResolveOptions {
	const a = inner?.transformPageChunk;
	const b = outer.transformPageChunk!;
	return {
		...inner,
		transformPageChunk: async (input) => {
			const html = a ? await a(input) : input.html;
			return html === undefined ? html : b({ ...input, html });
		}
	};
}

const server: ServerPlugin<DevtoolsServerOptions> = defineServer<DevtoolsServerOptions>({
	setup(app) {
		set_devtools_app(app as ServerApp<unknown>);
		if (app.options.profiler) install_request_stats();
	},
	async handle({ event, options }, resolve) {
		const config = options.profiler;
		const beacon = dock_measures(event) ? WITH_PAGE_BEACON : undefined;
		const next: typeof resolve =
			beacon && DOCK_LAZY ? (opts) => resolve(opts).then(never_stored) : resolve;
		if (!config) return next(beacon);
		// DEMAND-ONLY: until a request asks for the profiler's path (and only until the first one mounts
		// it), this app pays exactly what a profiler-less app pays
		if (
			profiler_demand_skip(
				!!config.onDemand,
				mounted !== null,
				event.url.pathname,
				config.path || '/__profiler'
			)
		)
			return next(beacon);
		const prof = await mount(config);
		if (!prof) return next(beacon);
		return prof({
			event,
			resolve: (_event, opts) => next(beacon ? after(opts, beacon) : opts)
		});
	},
	// SHARED HOOK: the profiler's logged-in user measures (core's `server-timing` on region answers).
	// Not mounted yet: nobody has logged in to it in this process.
	measures(event) {
		return mounted?.measures(event);
	}
});

export default server;
