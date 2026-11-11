/**
 * EVERY MESSAGE THE RESHAPE PACKAGE PRINTS, in one place: its code, its wording, what to do about it
 * (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   throw new OgygiaError('reshape_plugin_missing');
 *
 * The pass runs in the app's server, so the wording is only passed in dev and while prerendering: a
 * production server prints the code's page alone.
 */
import {
	define_messages,
	dev_or_prerender,
	prose,
	type MessagesOf
} from '@ogygia/core/internal/messages';
import { BROWSER, DEV } from 'esm-env';

/** The errors: `throw new OgygiaError(code, args)`. */
export const RESHAPE_ERRORS = {
	reshape_plugin_missing: {
		text: (): string => prose`
			reshape.handle({ transform }) runs, but reshape() is not in vite.config: list it beside
			ogygia() in \`plugins\`.
		`,
		details: (): string => prose`
			\`reshape.handle()\` hands the app's transform to ogygia, and the reshape plugin is what
			runs it (it marks the HTML before the transform and records what it moved after). Without
			the plugin the transform would never run, so every request fails instead.

			List \`reshape()\` (from \`@ogygia/reshape/vite\`) beside \`ogygia()\` in the \`plugins\` of
			vite.config.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const RESHAPE_WARNINGS = {};

type Own = MessagesOf<typeof RESHAPE_ERRORS, typeof RESHAPE_WARNINGS>;
// (the tables reach a dev build and the server's — a prerender words them too; a production browser
// bundle drops them)
const own: Own = /* @__PURE__ */ define_messages(
	DEV || !BROWSER ? RESHAPE_ERRORS : null,
	DEV || !BROWSER ? RESHAPE_WARNINGS : null,
	dev_or_prerender
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev and while prerendering, the link alone otherwise. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
