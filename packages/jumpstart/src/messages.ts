/**
 * Every message the jumpstart plugin prints, in one place: its code, its wording, what to do about
 * it. The plugin runs in Node, never in a page, so the wording always prints, then the code's page.
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const JUMPSTART_ERRORS = {
	jumpstart_option_unknown: {
		text: (a: { key: string }): string =>
			`jumpstart: no option named \`${a.key}\` (the one option is \`external\`)`,
		details: (): string => prose`
			\`jumpstart()\` takes one option, \`external\`: the packages that stay outside the server
			bundle. A key it does not know would be ignored without a word, so the build stops
			instead. Check the spelling.
		`
	},
	jumpstart_external_invalid: {
		text: (a: { value: string }): string =>
			`jumpstart: \`external\` takes a list of package names, and got ${a.value}`,
		details: (): string => prose`
			\`jumpstart({ external })\` is a list of package names, the way Vite's
			\`resolve.external\` takes them: \`external: ['sharp', '@acme/db']\`. Each one stays
			outside the server bundle and is imported from \`node_modules\` at run time.
		`
	}
};

/** The warnings: `warn(code, args)`; the build's report prints with `line(code, args)`. */
export const JUMPSTART_WARNINGS = {
	jumpstart_external: {
		text: (a: { count: string; list: string }): string =>
			`jumpstart: ${a.count} outside the server bundle: ${a.list}`,
		details: (): string => prose`
			\`jumpstart()\` bundles every dependency into the server build, so a cold start reads a
			few files instead of hundreds. This line names each package the server build still
			imports from \`node_modules\` at run time, and why: it is listed in
			\`jumpstart({ external })\`, it is external in the Vite config (\`resolve.external\` or
			\`ssr.external\`), or Vite or another plugin kept it out. The deploy needs each one
			installed.

			A package that cannot be bundled (a native addon, a package that reads files next to its
			own module, one that must be a single instance) goes in \`external\`.
		`
	},
	jumpstart_external_none: {
		text: (): string => `jumpstart: every dependency is inside the server bundle`,
		details: (): string => prose`
			\`jumpstart()\` bundled every dependency into the server build: it imports nothing from
			\`node_modules\` at run time. A package that cannot be bundled (a native addon, a package
			that reads files next to its own module, one that must be a single instance) goes in
			\`jumpstart({ external })\`.
		`
	}
};

type Own = MessagesOf<typeof JUMPSTART_ERRORS, typeof JUMPSTART_WARNINGS>;
const own: Own = define_messages(JUMPSTART_ERRORS, JUMPSTART_WARNINGS);
/** `throw new OgygiaError(code, args)`; `warn(code, args)` logs; `line(code, args)` is the line as a
 *  string. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
