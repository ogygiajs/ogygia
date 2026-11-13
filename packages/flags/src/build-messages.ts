/**
 * The messages `flags()` prints at BUILD time (the Vite plugin, in Node, never in a page): the
 * wording always prints, then the code's page. The runtime's own are in ./messages.ts.
 *
 *   console.log(line('flags_manifest_written', { count }));
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: none yet. */
export const FLAGS_BUILD_ERRORS = {};

/** The warnings, and the build's reports (printed at info level with `line(code, args)`). */
export const FLAGS_BUILD_WARNINGS = {
	flags_manifest_written: {
		text: (a: { count: number }): string =>
			`flags manifest: ${a.count} flag(s) → node_modules/.ogygia/flags-manifest.json`,
		details: (): string => prose`
			The build wrote the inventory of every \`flag()\` it found, with where each is read, to
			\`node_modules/.ogygia/flags-manifest.json\`. Tools (the devtools, a flag dashboard) read it
			from there.
		`
	}
};

type Own = MessagesOf<typeof FLAGS_BUILD_ERRORS, typeof FLAGS_BUILD_WARNINGS>;
const own: Own = /* @__PURE__ */ define_messages(FLAGS_BUILD_ERRORS, FLAGS_BUILD_WARNINGS);
/** `line(code, args)`: the line as a string. */
export const line: Own['line'] = own.line;
