/**
 * `@ogygia/core/internal/messages`: the message system for ogygia's first-party plugins (each makes
 * its own `OgygiaError`, `warn` and `line` from its own tables, ../contract/messages.ts) and core's
 * tables for the docs' `ogygiajs.dev/e` pages: the runtime's (and the code it shares with the
 * server) and the server's. The build's live with the compiler (`@ogygia/core/internal/compiler`).
 *
 * @packageDocumentation
 * @internal
 */
export {
	define_messages,
	dev_or_prerender,
	type MessageEntry,
	type MessageTableShape,
	type MessagesOf
} from '../contract/messages.ts';
export { prose } from '../contract/prose.ts';
export { ERRORS, WARNINGS } from './core.ts';
export { SERVER_ERRORS, SERVER_WARNINGS } from './server.ts';
