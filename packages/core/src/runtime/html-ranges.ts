import { HTML_RANGE_MARK, OG_HTML } from '../wire-markup.ts';
import { ANCHOR } from './svelte-markers.ts';

const MARK_HTML = `<!--${HTML_RANGE_MARK}-->`;
const INVERSE_31 = 3186588639;
const settled = new WeakSet<Node>();

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
 * DEV: give every marked `{@html}` range under `root` the open anchor Svelte's hydration reads. The
 * server hashed the value with its range mark in front; a production anchor is empty and carries no
 * hash. Each anchor is settled once.
 */
export function settle_html_ranges(root: Element): void {
	for (const el of root.querySelectorAll(`[${OG_HTML}]`)) {
		for (let n = el.firstChild; n; n = n.nextSibling) {
			if (n.nodeType !== 8 || (n as Comment).data !== HTML_RANGE_MARK) continue;
			const open = n.previousSibling;
			if (!open || open.nodeType !== 8 || settled.has(open)) continue;
			const data = (open as Comment).data;
			if (data === ANCHOR) continue;
			settled.add(open);
			(open as Comment).data = hash_without_mark(data);
		}
	}
}
