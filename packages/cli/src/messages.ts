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
	},
	cli_server_port_busy: {
		text: (a: { url: string; port: number; ms: number }): string => prose`
			port ${a.port} (${a.url}) is still held by another process after ${a.ms} ms: the server
			was not started.
		`,
		details: (): string => prose`
			\`ogygia bisect\` starts each commit's server (\`--start\`) on the port of \`--url\`, and
			waits for that port to be free first: a server still on it would answer the readiness
			check, and bisect would measure that server instead of the commit's. Its own servers are
			gone before the next one starts, so the process on the port is someone else's (a server
			left running in another terminal, an earlier run): stop it, or point \`--url\` at a free
			port.
		`
	},
	cli_server_exited_early: {
		text: (a: { cmd: string; how: string; output: string }): string => prose`
			the server (${a.cmd}) exited before it answered (${a.how}). Its last output:

			${a.output || '(none)'}
		`,
		details: (): string => prose`
			\`ogygia bisect\` started the commit's server with \`--start\` and it exited before
			\`--url\` answered: a server that cannot take its port (EADDRINUSE), a build output that
			is not there, or a crash on boot. Its output says which. The commit is skipped.
		`
	},
	cli_server_not_ready: {
		text: (a: { url: string; ms: number; output: string }): string => prose`
			the server did not answer at ${a.url} within ${a.ms} ms, and was stopped. Its last output:

			${a.output || '(none)'}
		`,
		details: (): string => prose`
			\`ogygia bisect\` polls \`--url\` until the commit's server answers (any status under 500),
			for up to \`--ready\` ms. A server that takes longer to boot needs a larger \`--ready\`; one
			that listens on another port needs \`--url\` to name that port. The commit is skipped.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const CLI_WARNINGS = {};

type Own = MessagesOf<typeof CLI_ERRORS, typeof CLI_WARNINGS>;
const own: Own = define_messages(CLI_ERRORS, CLI_WARNINGS);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. The CLI runs in Node, never in a page, so the wording prints in every build,
 *  then the code's page. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
