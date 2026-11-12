/**
 * The SERVER half of `devtools()` (its `server`). With the profiler on it
 * wraps every request (`handle`): it times the render and serves its UI at `/__profiler`, and turns
 * on core's request stats, its data. The profiler itself — node:inspector, crypto, the UI's render
 * path — loads on the first request through a dynamic import, so an app pays for it only when it is
 * on; with `onDemand`, only once someone opens the profiler.
 */
import { defineServer, type ServerApp, type ServerPlugin } from '@ogygia/core/plugin';
import { set_devtools_app } from './app.ts';
import { want_request_stats } from '@ogygia/core/internal/server';
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

const server: ServerPlugin<DevtoolsServerOptions> = defineServer<DevtoolsServerOptions>({
	setup(app) {
		set_devtools_app(app as ServerApp<unknown>);
		if (app.options.profiler) want_request_stats();
	},
	async handle({ event, options }, next) {
		const config = options.profiler;
		if (!config) return next();
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
			return next();
		const prof = await mount(config);
		if (!prof) return next();
		// the profiler's `resolve` options (its beacon tag's transformPageChunk) see the finished document
		return prof({ event, resolve: (_event, opts) => next(opts) });
	},
	// SHARED HOOK: the profiler's logged-in user measures (core's `server-timing` on region answers).
	// Not mounted yet: nobody has logged in to it in this process.
	measures(event) {
		return mounted?.measures(event);
	}
});

export default server;
