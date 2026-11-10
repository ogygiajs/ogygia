/**
 * VitePress-compatible custom containers — `::: tip`, `::: warning`, `::: danger`, `::: info`,
 * `::: note`, `::: caution`, `::: important`, and collapsible `::: details`, each with an optional
 * title on the opening line:
 *
 *   ::: warning Heads up
 *   Props must be serializable.
 *   :::
 *
 * A RAW-TEXT pass (before mdsvex/remark) so it doesn't matter whether the author leaves blank lines —
 * VitePress-style tight blocks work too, which CommonMark would otherwise fold into one paragraph. It
 * rewrites each block into an HTML wrapper the theme styles (`.og-admonition`), leaving a blank line
 * around the inner content so Markdown still renders inside. Fenced code is skipped, so a literal
 * `:::` inside a code block is untouched.
 */
import { html } from '@ogygia/core/plugin/utils';

const LABELS: Record<string, string> = {
	tip: 'TIP',
	info: 'INFO',
	note: 'NOTE',
	important: 'IMPORTANT',
	warning: 'WARNING',
	caution: 'CAUTION',
	danger: 'DANGER',
	details: 'Details'
};
// Aliases fold onto a known kind so styling stays in one place.
const KIND: Record<string, string> = {
	tip: 'tip',
	info: 'info',
	note: 'info',
	important: 'important',
	warning: 'warning',
	caution: 'warning',
	danger: 'danger',
	details: 'details'
};

const OPEN = /^:::\s*([A-Za-z][\w-]*)\s*(.*)$/;
const CLOSE = /^:::\s*$/;
const FENCE = /^(\s*)(`{3,}|~{3,})/;

/** True if the source contains any `:::` container marker (cheap gate to skip the line pass). */
export function has_containers(src: string): boolean {
	return src.includes(':::');
}

/** Rewrite VitePress `:::` containers to HTML admonitions. Idempotent-safe: only `:::`-marked lines. */
export function transform_containers(src: string): string {
	if (!has_containers(src)) return src;

	const lines = src.split('\n');
	const out: string[] = [];
	const open_kinds: string[] = []; // stack of open container kinds (for the matching close tag)
	let fence: string | null = null; // active code-fence marker char, or null

	for (const line of lines) {
		const fm = FENCE.exec(line);
		if (fm) {
			const ch = fm[2][0];
			if (fence === null) fence = ch;
			else if (ch === fence) fence = null;
			out.push(line);
			continue;
		}
		if (fence !== null) {
			out.push(line);
			continue;
		}

		if (CLOSE.test(line) && open_kinds.length) {
			const kind = open_kinds.pop()!;
			out.push('', kind === 'details' ? '</details>' : '</div>', '');
			continue;
		}

		const om = OPEN.exec(line);
		if (om && !CLOSE.test(line)) {
			const name = om[1].toLowerCase();
			const kind = KIND[name];
			if (kind) {
				const title = om[2].trim() || LABELS[name] || name.toUpperCase();
				open_kinds.push(kind);
				if (kind === 'details') {
					out.push(
						'',
						`<details class="og-admonition og-admonition-details">`,
						String(html`<summary class="og-admonition-title">${title}</summary>`),
						''
					);
				} else {
					out.push(
						'',
						`<div class="og-admonition og-admonition-${kind}" role="note">`,
						String(html`<p class="og-admonition-title">${title}</p>`),
						''
					);
				}
				continue;
			}
		}

		out.push(line);
	}

	// Unbalanced opens (author forgot a closing `:::`) — close them so markup stays valid.
	while (open_kinds.length) {
		const kind = open_kinds.pop()!;
		out.push('', kind === 'details' ? '</details>' : '</div>', '');
	}

	return out.join('\n');
}
