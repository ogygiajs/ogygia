/**
 * EVERY MESSAGE THE FLAGS PACKAGE PRINTS, in one place: its code, its wording, what to do about it
 * (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   warn('flags_plugin_not_running');
 *
 * Flag reads run in the app's server and its pages, so the wording is only passed in dev: a
 * production build prints the code's page alone.
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';
import { DEV } from 'esm-env';

/** The errors: `throw new OgygiaError(code, args)`. */
export const FLAGS_ERRORS = {};

/** The warnings: `warn(code, args, ...rest)`. */
export const FLAGS_WARNINGS = {
	flags_source_unprimed: {
		text: (): string => prose`
			flags: \`decide({ source })\` is set but no request was primed — list \`flags()\` beside
			\`ogygia()\` in vite.config \`plugins\`.
		`,
		details: (): string => prose`
			A flag has a \`source\`, but the request it was read in was never primed by the flags
			plugin, so every read ignores the source and falls back to the flag's own decision. Said
			once per server.

			List \`flags()\` (from \`@ogygia/flags/vite\`) beside \`ogygia()\` in the \`plugins\` of
			vite.config.
		`
	},
	flags_plugin_not_running: {
		text: (): string => prose`
			flags: a flag was read on the server but the flags plugin is not running — list
			\`flags()\` (from \`@ogygia/flags/vite\`) beside \`ogygia()\` in vite.config \`plugins\`.
			Until then flag reads are not reported to the request, and a stored page could keep one
			variant.
		`,
		details: (): string => prose`
			A flag was read on the server, but the flags plugin never started. Nothing tells the
			request that its page depends on a flag, so a store (a postrender cache) could keep one
			variant of an A/B-tested page and serve it to everyone. Said once per server.

			List \`flags()\` (from \`@ogygia/flags/vite\`) beside \`ogygia()\` in the \`plugins\` of
			vite.config.
		`
	}
};

type Own = MessagesOf<typeof FLAGS_ERRORS, typeof FLAGS_WARNINGS>;
const own: Own = /* @__PURE__ */ define_messages(
	DEV ? FLAGS_ERRORS : null,
	DEV ? FLAGS_WARNINGS : null
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev, the link alone in a production build. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
