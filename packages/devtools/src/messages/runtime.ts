/**
 * EVERY MESSAGE THE PROFILER'S SERVER HALF PRINTS, in one place: its code, its wording, what to do
 * about it (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   console.error(new OgygiaError('devtools_profiler_store_init_failed'), e);
 *   warn('devtools_profiler_session_rejected', { path, diagnosis, reason });
 *
 * It runs in the app's server build, so the wording is only passed in dev: a production build prints
 * the code's page alone. The Vite plugin's messages are in ./build.ts.
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

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
	devtools_profiler_get_report_failed: {
		text: (): string => 'store.getReport failed:',
		details: (): string => prose`
			Printed with \`OGYGIA_PROFILER_DEBUG\` set. The profiler's \`store\` failed to read a
			report back (the error follows the message), so the report is answered as not found.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const DEVTOOLS_WARNINGS = {
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
	}
};

type Own = MessagesOf<typeof DEVTOOLS_ERRORS, typeof DEVTOOLS_WARNINGS>;
// (`?.`: a plain Node import — a test, a script — has no `import.meta.env`; it gets the link alone)
const own: Own = /* @__PURE__ */ define_messages(
	import.meta.env?.DEV ? DEVTOOLS_ERRORS : null,
	import.meta.env?.DEV ? DEVTOOLS_WARNINGS : null
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev, the link alone in a production build. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
