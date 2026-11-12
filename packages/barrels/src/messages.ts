/**
 * EVERY MESSAGE THE BARRELS PLUGIN PRINTS, in one place: its code, its wording, what to do about it
 * (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   warn('barrels_component_skipped', { file, reason, at });
 *
 * The plugin runs in Node, never in a page, so the wording always prints, then the code's page.
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const BARRELS_ERRORS = {};

/** The warnings: `warn(code, args, ...rest)`; the build's reports print with `line(code, args)`. */
export const BARRELS_WARNINGS = {
	barrels_component_skipped: {
		text: (a: { file: string; reason: string; at: string }): string =>
			`barrels: skipped ${a.file}: ${a.reason}${a.at ? ` at ${a.at}` : ''} — its imports stay on their barrels`,
		details: (): string => prose`
			\`barrels()\` rewrites imports from an index file (a barrel) to the files that define
			them, so an island ships only what it uses. It could not parse this component, so its
			imports stay as written and its island ships each barrel whole.
		`
	},

	// ── the build's reports: printed at info level with `line(code, args)`, never warned ──────────
	barrels_report: {
		text: (a: {
			importers: string;
			files: string;
			imports: string;
			names: string;
			barrels: string;
			seconds: string;
		}): string =>
			`barrels: ${a.importers} of ${a.files} files rewritten — ${a.imports} barrel imports → leaves ` +
			`(${a.names} names), ${a.barrels} barrels bypassed, ${a.seconds} s first to last transform`,
		details: (): string => prose`
			\`barrels()\` rewrote imports from index files (barrels) to the files that define each
			name, so an island ships only what it uses. The report counts the rewrites and lists the
			barrels that were bypassed the most, with how many files imported through each.

			\`barrels({ report: 'all' })\` lists every barrel, \`report: false\` turns the report off,
			and \`debug: true\` prints each rewrite as it happens.
		`
	},
	barrels_report_none: {
		text: (a: { files: string; seconds: string }): string =>
			`barrels: ${a.files} files scanned, no barrel imports to rewrite (${a.seconds} s)`,
		details: (): string => prose`
			\`barrels()\` looked for imports through index files (barrels) to rewrite to the files
			that define each name, and found none. Nothing to do.
		`
	},
	barrels_rewrite: {
		text: (a: { file: string; names: string; barrel: string; leaves: string }): string =>
			`barrels: ${a.file}: ${a.names} ← ${a.barrel} → ${a.leaves}`,
		details: (): string => prose`
			With \`barrels({ debug: true })\`, each rewritten import is printed: the names, the index
			file (barrel) they were imported through, and the files that define them, which the
			import now points at.
		`
	}
};

type Own = MessagesOf<typeof BARRELS_ERRORS, typeof BARRELS_WARNINGS>;
const own: Own = define_messages(BARRELS_ERRORS, BARRELS_WARNINGS);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
