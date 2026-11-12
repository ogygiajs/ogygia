/**
 * Every message the testing package prints: its code, its wording, and what to do about it
 * (`@ogygia/core/internal/messages` is the system).
 *
 *   throw new OgygiaError('testing_api_absent');
 *   warn('testing_engine_older', { at, version, expected });
 *
 * @packageDocumentation
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const TESTING_ERRORS = {
	testing_api_absent: {
		text: (): string => prose`
			ogygia's testing API is not in this page. Serve the app with the devtools plugin listed
			beside ogygia() (\`plugins: [ogygia(), devtools(), sveltekit()]\`) (the dev server, or a
			preview build) and open a csr = false page.
		`,
		details: (): string => prose`
			The test waited for the page's testing API (\`window.__ogygia_testing\`) and it never
			appeared. The devtools plugin puts it there, on csr=false pages.

			List \`devtools()\` (from \`@ogygia/devtools/vite\`) beside \`ogygia()\` in vite.config,
			serve the app with the dev server or a preview build, and point the test at a csr=false
			page.
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const TESTING_WARNINGS = {
	testing_engine_older: {
		text: (a: { at: string; version: number; expected: number }): string => prose`
			the page${a.at ? ` at ${a.at}` : ''} runs an older testing engine (version ${a.version},
			this package expects ${a.expected}): its reports lack instance keys, finding names,
			counts.cls and what started each navigation. Filled in where the test side knows
			(navigations).
		`,
		details: (): string => prose`
			The site under test was built with an older ogygia than this \`@ogygia/testing\`, so its
			testing engine answers less: no instance keys, no finding names, no \`counts.cls\`, no
			cause for each navigation. The test side fills in what it can. Said once per site.

			Update the site's ogygia packages to the version of \`@ogygia/testing\`.
		`
	}
};

type Own = MessagesOf<typeof TESTING_ERRORS, typeof TESTING_WARNINGS>;
const own: Own = define_messages(TESTING_ERRORS, TESTING_WARNINGS);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
