/**
 * EVERY MESSAGE THE PROFILER'S SERVER HALF AND THE DOCK PRINT, in one place: its code, its wording,
 * what to do about it (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   console.error(new OgygiaError('devtools_profiler_store_init_failed'), e);
 *   warn('devtools_profiler_session_rejected', { path, diagnosis, reason });
 *
 * It runs in the app's server build (and the dock's launcher in its browser bundle), so the wording is
 * only passed in dev: a production build prints the code's page alone. The Vite plugin's messages are
 * in ./build.ts.
 */
import {
	define_messages,
	dev_or_prerender,
	prose,
	type MessagesOf
} from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`, or `console.error(new OgygiaError(…), err)` for a
 *  failure that is caught. */
export const DEVTOOLS_ERRORS = {
	devtools_profiler_store_init_failed: {
		text: (): string => 'store init failed; falling back to in-memory:',
		details: (): string => prose`
			The profiler's \`store\` threw while it initialized (a missing driver, a bad path, a
			database it cannot reach; the error follows the message). The profiler keeps its reports
			in memory instead, so they are gone when the server restarts.
		`
	},
	devtools_profiler_mount_failed: {
		text: (): string => 'the profiler could not start; requests are served without it:',
		details: (): string => prose`
			The profiler (\`devtools({ profiler })\`) loads on the first request, and loading it
			failed (the error follows the message): a runtime without \`node:inspector\` (an edge
			runtime), or a dev server in the middle of an edit. Every request is still answered,
			unprofiled, and the next request tries to start it again. Said once per server.
		`
	},
	devtools_profiler_alloc_sampling_unavailable: {
		text: (): string => 'allocation sampling unavailable, GC attribution off:',
		details: (): string => prose`
			Printed with \`OGYGIA_PROFILER_DEBUG\` set. The runtime refused the heap sampling the
			profiler asked for (the error follows the message), so this recording does not say which
			code caused its garbage collection.
		`
	},
	devtools_profiler_gc_attribution_failed: {
		text: (): string => 'GC attribution failed:',
		details: (): string => prose`
			Printed with \`OGYGIA_PROFILER_DEBUG\` set. Working out which code caused the recording's
			garbage collection threw (the error follows the message); the report leaves that part
			out.
		`
	},
	devtools_profiler_put_report_failed: {
		text: (): string => 'store.putReport failed:',
		details: (): string => prose`
			Printed with \`OGYGIA_PROFILER_DEBUG\` set. The profiler's \`store\` failed to save a
			report (the error follows the message). The report stays in memory, but is gone when the
			server restarts.
		`
	},
	devtools_profiler_upload_too_large: {
		text: (a: { limit: number }): string =>
			`that .ogp file unpacks to more than ${Math.round(a.limit / 1_048_576)} MB; it was refused`,
		details: (): string => prose`
			An uploaded \`.ogp\` profile is Brotli-compressed, and it unpacked past the profiler's
			limit, so the profiler stopped unpacking it and refused it. A real profile is far smaller:
			the file was not made by a profiler, or it was made to fill the server's memory.
		`
	},
	devtools_profiler_get_report_failed: {
		text: (): string => 'store.getReport failed:',
		details: (): string => prose`
			Printed with \`OGYGIA_PROFILER_DEBUG\` set. The profiler's \`store\` failed to read a
			report back (the error follows the message), so the report is answered as not found.
		`
	},
	devtools_profiler_secret_short: {
		text: (a: { bytes: number }): string =>
			`the profiler secret is ${a.bytes} bytes, under the 16 a production profiler needs; its pages stay closed`,
		details: (): string => prose`
			In production the profiler opens its pages, its \`x-profiler-key\` header and its
			\`x-profile\` header only to a secret of at least 16 bytes (\`profiler({ secret })\` or
			\`OGYGIA_PROFILER_SECRET\`): a shorter one can be guessed. Until then the profiler
			records as usual and nobody can log in to it. Set a longer secret, for example the output
			of \`openssl rand -hex 32\`.
		`
	},
	devtools_dock_load_failed: {
		text: (): string => 'the devtools dock’s code failed to load (click its button to try again):',
		details: (): string => prose`
			The browser could not download the devtools dock's code (the network failed, or a deploy
			removed the file; the error follows the message). The page is not affected, and the
			dock's button stays: a click, or Alt+O, asks for the code again under a fresh URL.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const DEVTOOLS_WARNINGS = {
	devtools_page_beacon_load_failed: {
		text: (): string =>
			'the page beacon failed to load or to start, so this page is not measured (the next page load tries again):',
		details: (): string => prose`
			Devtools is switched on in this browser and the page had no beacon of its own (an app
			without ogygia's handle gets none from the server), so the dock asked for the beacon's code.
			The browser could not download it (the network failed, or a deploy removed the file), or the
			beacon threw as it started; the error follows the message. The page works as before, but
			this visit is missing from the profiler. The next page load asks for the code again.

			If a download keeps failing, check that the build's \`_app\` files are deployed and
			reachable. Said once per page.
		`
	},
	devtools_profiler_session_rejected: {
		text: (a: { path: string; diagnosis: string; reason: string }): string =>
			`session not accepted on ${a.path}: ${a.diagnosis} — ${a.reason}`,
		details: (): string => prose`
			A browser sent a profiler session cookie, or had just logged in, and the profiler still
			did not accept it. \`diagnosis\` counts what the request carried (never a cookie's value)
			and \`reason\` reads it: no cookie reached the server (a proxy or CDN in front of the app
			drops it), the browser sent several session cookies, or the session is not valid (the
			profiler secret differs between server instances).

			Forward cookies to the profiler's path, clear the site's cookies and log in again, or
			give every instance the same secret.
		`
	},
	devtools_profiler_sink_undelivered: {
		text: (a: { rows: string }): string =>
			`the sink never took a post of ${a.rows} rows, after every try; they are dropped:`,
		details: (): string => prose`
			The profiler posts the rows it reads (\`sink: { url }\`) one post at a time, in order, and
			tries a failed post again a few times before the next one goes. This post failed every
			time (the last error follows the message), so its rows are not at the sink and the site
			view misses those requests. The site page shows the sink's last answer.

			Check the sink's URL, its key, and that it answers 2xx once it stored a post. A post
			carries an \`idempotency-key\` header: a sink that stored a post already can answer ok
			for its copy.
		`
	},
	devtools_profiler_background_stopped: {
		text: (a: { loop: string }): string =>
			`the profiler's ${a.loop} stopped: a background window failed:`,
		details: (): string => prose`
			The trap (\`trap\`) and the always-on sampler (\`sample\`) record short windows in the
			background with the process's inspector. One of those windows failed (the error follows
			the message): most often the inspector is held by another debugger, or the host has none.
			That loop records no more windows in this process; the dashboard says so under "In the
			background", with what the trap caught before it stopped.

			Detach the other debugger and restart the server, or turn \`trap\` / \`sample\` off on this
			host.
		`
	}
};

type Own = MessagesOf<typeof DEVTOOLS_ERRORS, typeof DEVTOOLS_WARNINGS>;
// (the tables reach a dev build and the server's — a prerender words them too; a production browser
// bundle drops them. `?.`: a plain Node import has no `import.meta.env`, it gets the link alone)
const own: Own = /* @__PURE__ */ define_messages(
	import.meta.env?.DEV || import.meta.env?.SSR ? DEVTOOLS_ERRORS : null,
	import.meta.env?.DEV || import.meta.env?.SSR ? DEVTOOLS_WARNINGS : null,
	dev_or_prerender
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev and while prerendering, the link alone otherwise. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
