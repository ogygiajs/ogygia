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
			reshape.handle(transform) runs, but reshape() is not in vite.config: list it beside
			ogygia() in \`plugins\`.
		`,
		details: (): string => prose`
			\`reshape.handle()\` hands the app's transform to ogygia, and the reshape plugin is what
			runs it (it marks the HTML before the transform and records what it moved after). Without
			the plugin the transform would never run, so every request fails instead.

			List \`reshape()\` (from \`@ogygia/rewrite/vite\`) beside \`ogygia()\` in the \`plugins\` of
			vite.config.
		`
	},
	reshape_pass_failed: {
		text: (a: { kind: string; error: string }): string =>
			`the reshape transform threw on a ${a.kind}: ${a.error}`,
		details: (): string => prose`
			The function given to \`reshape.handle()\` threw while it rendered a document or a region
			answer. In production that answer goes out as ogygia rendered it, before the transform,
			and this is said once for it; in dev it is thrown, so a broken transform shows at once.

			Make the transform catch what its renderer throws and answer the HTML it was given.
		`
	},
	reshape_marks_lost: {
		text: (a: { kind: string; lost: number }): string =>
			`the reshape transform dropped ogygia's marks from ${a.lost} host(s) it restores, in a ${a.kind}.`,
		details: (): string => prose`
			ogygia marks each custom element it will restore (\`og-h\`) before the transform, and puts
			Svelte's markup back in the browser before anything hydrates. A transform that drops those
			attributes (a serializer that keeps only known attributes, a sanitizer) leaves nothing to
			restore by: Svelte would hydrate the transform's markup, mismatch and mount the region
			again. In production that answer goes out as ogygia rendered it, before the transform, and
			this is said once for it; in dev it is thrown.

			Carry every \`og-*\` attribute and comment along wherever the transform moves a node.
		`
	},
	restore_markup_broken: {
		text: (a: { diff: string }): string => `the transform broke hydration markup: ${a.diff}`,
		details: (): string => prose`
			A transform rewrote a restored region's markup so that its hydration markers no longer
			match. \`diff\` names the first difference. (The restore runs as a self-contained script,
			so it prints this code's link itself.)
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const RESHAPE_WARNINGS = {
	restore_late: {
		text: (a: { host: string }): string =>
			`<${a.host}> was upgraded before the restore reached it; its own root is kept and the server's copy of its render dropped.`,
		details: (): string => prose`
			A custom element of a reversible transform (an \`og-h\` host) already had a shadow root when
			the restore reached it: a component runtime upgraded it first. The restore keeps the root
			the component made, puts its light DOM back into Svelte's form (its children, its
			attributes) and drops the server's rendered copy, which would otherwise show a second time
			through the slot. Until the component renders, that part of the page is empty.

			Load the component runtime after ogygia's restore (the pass inlines it at the end of the
			body), or let it hydrate a declarative root instead of attaching its own in the
			constructor. Said once per page and element name.
		`
	}
};

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
