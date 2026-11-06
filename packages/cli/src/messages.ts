/**
 * EVERY MESSAGE THE CLI PRINTS AS AN OGYGIA MESSAGE, in one place: its code, its wording, what to do
 * about it (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   fail(line('cli_transform_failed', { error }));
 *
 * The CLI runs in Node, never in a page, so the wording always prints, then the code's page. (The
 * commands' own usage lines and `✗` failures are terminal output, not messages.)
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`, or `line(code, args)` where an error is answered
 *  as text (an MCP tool's result). */
export const CLI_ERRORS = {
	cli_transform_failed: {
		text: (a: { error: string }): string => prose`
			transform error:

			${a.error}
		`,
		details: (): string => prose`
			An MCP tool (\`ogygia_compile\`, \`ogygia_islands\`, \`ogygia_explain\`) ran ogygia's
			transform on the component it was given, and the transform threw. \`error\` is the
			transform's own message, which usually names the rule the component breaks and links its
			page.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const CLI_WARNINGS = {};

type Own = MessagesOf<typeof CLI_ERRORS, typeof CLI_WARNINGS>;
const own: Own = define_messages(CLI_ERRORS, CLI_WARNINGS);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
