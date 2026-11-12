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

/**
 * Rewrites VitePress `:::` containers to HTML admonitions: `::: tip`, `::: warning`, `::: danger`,
 * `::: info`, `::: important`, the aliases `::: note` (styled as info) and `::: caution` (styled as
 * warning), and a collapsible `::: details`, each with an optional title on the opening line:
 *
 *   ::: warning Heads up
 *   Props must be serializable.
 *   :::
 *
 * A raw-text pass before mdsvex, so a tight block (no blank lines), which CommonMark would fold into
 * one paragraph, works too: the wrapper the theme styles (`.og-admonition`) gets a blank line on each
 * side of the body, so Markdown still renders inside. The title is written into the `.svx` source as
 * Svelte markup, braces escaped (#469). A `:::` inside fenced code is left as it is. Containers nest,
 * and one the author never closed is closed at the end. Only `:::` lines change.
 */
export function transform_containers(src: string): string {
	if (!has_containers(src)) return src;

	const lines = src.split('\n');
	const out: string[] = [];
	const open_kinds: string[] = [];
	let fence: string | null = null;

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
						String(html.svelte`<summary class="og-admonition-title">${title}</summary>`),
						''
					);
				} else {
					out.push(
						'',
						`<div class="og-admonition og-admonition-${kind}" role="note">`,
						String(html.svelte`<p class="og-admonition-title">${title}</p>`),
						''
					);
				}
				continue;
			}
		}

		out.push(line);
	}

	while (open_kinds.length) {
		const kind = open_kinds.pop()!;
		out.push('', kind === 'details' ? '</details>' : '</div>', '');
	}

	return out.join('\n');
}
