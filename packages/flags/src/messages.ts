import {
	define_messages,
	dev_or_prerender,
	prose,
	type MessagesOf
} from '@ogygia/core/internal/messages';
import { BROWSER, DEV } from 'esm-env';

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
	flags_exposure_failed: {
		text: (): string => prose`
			flags: the exposure sink (\`decide({ exposure })\`) failed, and the batch it was sent is lost.
			The error follows.
		`,
		details: (): string => prose`
			The function given to \`decide({ exposure })\` threw, or the promise it returned rejected (a
			send that failed), so the exposures in that batch did not reach your analytics. The request
			that read the flags is not affected. Said once, then again only after a send has worked:
			a sink that stays down does not fill the log.

			Check the sink's endpoint and credentials. To keep a batch through an outage, retry or
			queue inside the sink.
		`
	},
	flags_source_failed: {
		text: (): string => prose`
			flags: the flag source (\`decide({ source })\`) failed, so its flags fell back to their own
			rule. The error follows.
		`,
		details: (): string => prose`
			The source given to \`decide({ source })\` threw, rejected, or (with \`ofrep()\`) its
			endpoint answered an error or could not be reached in time; with \`openfeature()\`, one
			flag's evaluation threw. The request is not affected: each flag the source did not answer
			is decided by its own rollout, as if there were no source. Said once, then again only
			after a request the source served worked: a source that stays down does not fill the log.

			Check the vendor's status, the endpoint and its credentials, and \`ofrep({ timeout })\`.
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
	DEV || !BROWSER ? FLAGS_ERRORS : null,
	DEV || !BROWSER ? FLAGS_WARNINGS : null,
	dev_or_prerender
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev and while prerendering, the link alone otherwise. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
