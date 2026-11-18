import { HTML_RANGE_MARK, OG_HTML } from '../wire-markup.ts';
import { ANCHOR } from './svelte-markers.ts';
import { DEV } from 'esm-env';

const MARK_HTML = `<!--${HTML_RANGE_MARK}-->`;
const INVERSE_31 = 3186588639;

/**
 * Svelte's dev hash of an `{@html}` value, given its hash with the server's range mark in front:
 * the hash Svelte's dev hydration checks the value against. Svelte's hash folds the string from its
 * last character to its first (`h = 31h ^ c`, mod 2^32), so the mark's characters come off first.
 */
export function hash_without_mark(marked: string): string {
	let h = parseInt(marked, 36);
	for (let i = 0; i < MARK_HTML.length; i++) h = Math.imul(h ^ MARK_HTML.charCodeAt(i), INVERSE_31);
	return (h >>> 0).toString(36);
}

/**
 * Take every `{@html}` range mark under `root` out, just before Svelte hydrates it: Svelte then
 * reads its own server output, even where the client's value is empty and the server's is not. In
 * DEV, the open anchor's hash (the server hashed the value with the mark in front) becomes the
 * value's own.
 */
export function unmark_html_ranges(root: Element): void {
	for (const el of root.querySelectorAll(`[${OG_HTML}]`)) {
		let n = el.firstChild;
		while (n) {
			const next = n.nextSibling;
			const open = n.previousSibling;
			if (
				n.nodeType === 8 &&
				(n as Comment).data === HTML_RANGE_MARK &&
				open &&
				open.nodeType === 8
			) {
				if (DEV && (open as Comment).data !== ANCHOR)
					(open as Comment).data = hash_without_mark((open as Comment).data);
				el.removeChild(n);
			}
			n = next;
		}
	}
}
