/**
 * `@ogygia/core/internal/messages`: the message system for ogygia's first-party plugins (each makes
 * its own `OgygiaError`, `warn` and `line` from its own tables, ./define.ts) and core's tables for
 * the docs' `ogygiajs.dev/e` pages — the runtime's (and the code it shares with the server), the
 * server's, and the build's.
 *
 * @packageDocumentation
 * @internal
 */
export {
	define_messages,
	type MessageEntry,
	type MessageTableShape,
	type MessagesOf
} from './define.ts';
export { prose } from './prose.ts';
export { ERRORS, WARNINGS } from './core.ts';
export { SERVER_ERRORS, SERVER_WARNINGS } from './server.ts';
export { BUILD_ERRORS, BUILD_WARNINGS } from './build.ts';
