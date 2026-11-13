/**
 * EVERY MESSAGE THE BAKE PLUGIN PRINTS, in one place: its code, its wording, what to do about it
 * (core's `@ogygia/core/internal/messages` says how the system works).
 *
 *   throw new OgygiaError('macro_bake_arity', { file, line });
 *
 * The plugin runs in Node, never in a page, so the wording always prints, then the code's page.
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const BAKE_ERRORS = {
	macro_bake_arity: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.bake(fn) takes exactly one argument (a function).`,
		details: (): string => prose`
			\`import.meta.og.bake\` runs one function at build time and inlines its result. It takes
			that function and nothing else: \`import.meta.og.bake(() => buildNav())\`.
		`
	},
	macro_bake_not_function: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.bake(fn): the argument must be a function (\`() => …\`).`,
		details: (): string => prose`
			\`import.meta.og.bake\` was given something other than an inline function (a variable, a
			value). The build evaluates the function's own source, so write it inline:
			\`import.meta.og.bake(() => buildNav())\`.
		`
	},
	macro_bake_eval_failed: {
		text: (a: { file: string; reason: string }): string => prose`
			import.meta.og.bake() in ${a.file}: evaluating the function failed — ${a.reason}. A baked
			function may use this module's IMPORTS and literals only (not its other local variables),
			and must not touch runtime-only modules ($app/*, the browser).
		`,
		details: (): string => prose`
			The build bundled the baked function with the module's imports and ran it, and it threw.
			\`reason\` is the error.

			The function runs alone, at build time: it sees the module's imports and literals, not its
			other local variables, and there is no request, no \`$app/*\` module and no browser. Move
			what it needs into an import.
		`
	},
	macro_bake_not_serializable: {
		text: (a: { file: string; line: number; reason: string }): string => prose`
			${a.file}:${a.line} — import.meta.og.bake(): the result is not serializable (${a.reason}).
			bake produces DATA — return plain values (JSON + Date/Map/Set/RegExp/BigInt), never a
			function, Promise, or class instance.
		`,
		details: (): string => prose`
			The baked function ran, but its result cannot be written into the module as a constant.
			\`reason\` names the value that failed.

			Return plain data: JSON values, \`Date\`, \`Map\`, \`Set\`, \`RegExp\`, \`BigInt\`. A
			function, a promise or a class instance cannot be baked.
		`
	}
};

/** The warnings: none yet. */
export const BAKE_WARNINGS = {};

type Own = MessagesOf<typeof BAKE_ERRORS, typeof BAKE_WARNINGS>;
const own: Own = define_messages(BAKE_ERRORS, BAKE_WARNINGS);
/** `throw new OgygiaError(code, args)`. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
