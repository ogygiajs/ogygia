/**
 * EVERY MESSAGE THE DEVTOOLS' VITE PLUGIN PRINTS, in one place: its code, its wording, what to do
 * about it (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   warn('devtools_on_in_build');
 *
 * The plugin runs in Node, never in a page, so the wording always prints, then the code's page. The
 * profiler's server half has its own (./runtime.ts).
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const DEVTOOLS_BUILD_ERRORS = {};

/** The warnings: `warn(code, args, ...rest)`. */
export const DEVTOOLS_BUILD_WARNINGS = {
	devtools_on_in_build: {
		text: (): string => prose`
			devtools is ON for this build: its pages carry the devtools launcher (the dock loads only
			when opened). Keep it off for production: list \`devtools()\` only when
			\`mode !== 'production'\`.
		`,
		details: (): string => prose`
			A build ran with the devtools dock on, so every page it serves carries the devtools
			launcher. The dock itself loads only when someone opens it. Said once per build, so a
			dock left on by accident is seen before it ships.

			To keep it out of production, list \`devtools()\` only when
			\`mode !== 'production'\`.
		`
	},
	devtools_profiler_secret_empty: {
		text: (): string => prose`
			profiler: \`profiler.secret\` is EMPTY in this build — the variable it reads is not set in
			the BUILD environment. The UI will be DISABLED in production unless OGYGIA_PROFILER_SECRET
			exists at runtime (on Amplify / Lambda it does not): /__profiler will answer "installed but
			disabled". Set the variable where the build runs, and keep the \`profiler\` option
			unconditional.
		`,
		details: (): string => prose`
			The profiler was given a \`secret\`, but it is empty while the app builds: the environment
			variable it reads is not set where the build runs. The secret is baked in at build time,
			so the profiler's UI stays disabled in production unless \`OGYGIA_PROFILER_SECRET\` is
			set on the running server, which some hosts never do.

			Set the variable in the build environment, and keep the \`profiler\` option
			unconditional.
		`
	}
};

type Own = MessagesOf<typeof DEVTOOLS_BUILD_ERRORS, typeof DEVTOOLS_BUILD_WARNINGS>;
const own: Own = define_messages(DEVTOOLS_BUILD_ERRORS, DEVTOOLS_BUILD_WARNINGS);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
