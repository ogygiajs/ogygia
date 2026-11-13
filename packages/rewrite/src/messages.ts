import {
	define_messages,
	dev_or_prerender,
	prose,
	type MessagesOf
} from '@ogygia/core/internal/messages';
import { BROWSER, DEV } from 'esm-env';
import { OG_HEAD } from '@ogygia/core/internal/instruments';

/** The errors: `throw new OgygiaError(code, args)`. */
export const REWRITE_ERRORS = {
	rewrite_plugin_missing: {
		text: (): string => prose`
			a rewrite() handle runs, but rewrite() is not in vite.config: list it beside ogygia() in
			\`plugins\`.
		`,
		details: (): string => prose`
			A rewrite from \`@ogygia/rewrite\` is a Kit handle, and the rewrite plugin is what runs it:
			it marks the HTML before your render and puts back what the render moved before anything
			hydrates. Without the plugin your render would never run, so every request fails instead.

			List \`rewrite()\` (from \`@ogygia/rewrite/vite\`) beside \`ogygia()\` in the \`plugins\` of
			vite.config. It takes no options.
		`
	},
	rewrite_after_ogygia: {
		text: (): string => prose`
			a rewrite() handle runs after ogygia.handle(): put it before ogygia.handle() in
			sequence().
		`,
		details: (): string => prose`
			ogygia reads the request's rewrites when its own handle starts, so a rewrite placed after
			it would never run on this response. Rewrites run in the order they are listed, all before
			ogygia:

			\`sequence(first, second, ogygia.handle())\`
		`
	},
	rewrite_page_failed: {
		text: (a: { kind: string; error: string }): string =>
			`the page rewrite failed on a ${a.kind}: ${a.error}`,
		details: (): string => prose`
			The \`page\` function given to \`rewrite()\` threw, or dropped ogygia's \`og-h\` marks from a
			host ogygia restores. In production that document or answer goes out as ogygia rendered it,
			and this is said once for it; in dev it is thrown, so a broken rewrite shows at once.

			Make the function catch what its renderer throws, and carry every \`og-*\` attribute and
			comment along wherever it moves a node.
		`
	},
	restore_markup_broken: {
		text: (a: { diff: string }): string => `the rewrite broke hydration markup: ${a.diff}`,
		details: (): string => prose`
			A rewrite changed a restored region's markup so that its hydration markers no longer match.
			\`diff\` names the first difference. (The restore runs as a self-contained script, so it
			prints this code's link itself.)
		`
	}
};

/** The warnings: `warn(code, args, ...rest)`. */
export const REWRITE_WARNINGS = {
	rewrite_element_failed: {
		text: (a: { name: string; error: string }): string =>
			`the rewrite could not render <${a.name}>: ${a.error}. It went out as ogygia rendered it.`,
		details: (): string => prose`
			Your \`render\` threw, returned the wrong number of results, or returned something that is
			not HTML closing everything it opens. ogygia called it again for each element alone; this
			one still failed, so it went out as ogygia rendered it and renders in the browser. The rest
			of the page is not affected. Said once per response and element name, in every build.

			Make \`render\` return one result per element it was given, in order, each one HTML that
			closes what it opens.
		`
	},
	rewrite_marks_lost: {
		text: (a: { name: string }): string =>
			`the rewrite's render of <${a.name}> dropped ogygia's marks; it went out as ogygia rendered it.`,
		details: (): string => prose`
			ogygia marks each custom element it will restore (\`og-h\`) before your render, and puts
			Svelte's markup back in the browser before anything hydrates. This render dropped the mark
			(a serializer that keeps only known attributes, a sanitizer), which leaves nothing to
			restore by: Svelte would hydrate the render's markup, mismatch and mount the region again.
			So the element went out as ogygia rendered it. Said once per response and element name.

			Carry every \`og-*\` attribute and comment along wherever the render moves a node.
		`
	},
	rewrite_element_split: {
		text: (a: { name: string }): string =>
			`<${a.name}> did not close before its chunk of the page ended; it went out unrendered.`,
		details: (): string => prose`
			The page streams, and a matched element started in one chunk and ends in a later one (an
			\`{#await}\` inside it). Rendering it would mean holding the chunk until it closes, so it
			goes out as ogygia rendered it and renders in the browser. Said in dev, once per response.

			Keep streamed blocks out of matched elements, or put the element inside the streamed block.
		`
	},
	rule_rewrite_after_cancel: {
		text: (a: { detail: string }): string =>
			`rule broken, a cancelled request's rewrite stops: ${a.detail}`,
		details: (): string => prose`
			Dev and e2e only (a rule ogygia checks on itself). Once the request is cancelled (the
			visitor left, the connection closed), its rewrites stop: no render is called, no result is
			written into the page, and no failure is said, since nobody receives the page. One went on:
			that is a bug in ogygia, please report it.
		`
	},
	restore_late: {
		text: (a: { host: string }): string =>
			`<${a.host}> was upgraded before the restore reached it; its own root is kept and the server's copy of its render dropped.`,
		details: (): string => prose`
			A custom element ogygia restores (an \`og-h\` host) already had a shadow root when the
			restore reached it: a component runtime upgraded it first. The restore keeps the root the
			component made, puts its light DOM back into Svelte's form (its children, its attributes)
			and drops the server's rendered copy, which would otherwise show a second time through the
			slot. Until the component renders, that part of the page is empty.

			Load the component runtime after ogygia's restore (it is inlined after the elements it
			restores), or let it hydrate a declarative root instead of attaching its own in the
			constructor. Said once per page and element name.
		`
	},
	restore_sheet_missing: {
		text: (a: { host: string; key: string }): string =>
			`<${a.host}> names the shadow sheet "${a.key}" in og-shadow, but the page carries no sheet with that key; its shadow root goes without it.`,
		details: (): string => prose`
			A render of a host's plan names the sheets for its shadow root in \`og-shadow="key …"\`.
			The restorer finds each one as \`<template ${OG_HEAD}="key">\` in the page (or in the
			answer that brought the host). A key with no such template gives the root nothing, so the
			component paints without that sheet until its own runtime styles it.

			Return the sheet in the result's \`sheets\` with \`scope: 'shadow'\` for every key the render
			names (a \`'page'\` sheet is not a shadow sheet), or stop naming the key. Said once per page
			and key.
		`
	}
};

type Own = MessagesOf<typeof REWRITE_ERRORS, typeof REWRITE_WARNINGS>;
const own: Own = /* @__PURE__ */ define_messages(
	DEV || !BROWSER ? REWRITE_ERRORS : null,
	DEV || !BROWSER ? REWRITE_WARNINGS : null,
	dev_or_prerender
);
/** `throw new OgygiaError(code, args)`; `warn(code, args, ...rest)` logs; `line(code, args)` is the
 *  line as a string. Wording and link in dev and while prerendering, the link alone otherwise. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
export const warn: Own['warn'] = own.warn;
export const line: Own['line'] = own.line;
