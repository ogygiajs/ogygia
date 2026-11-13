import { next_open_or_close } from '@ogygia/core/internal/server';

export type RegionKind = 'island' | 'lake' | 'hole';

export interface RegionSpan {
	/** `island` = a hydrated region (its bytes are off-limits to any post-SSR reshaping); `lake` = a
	 *  frozen (`wake="none"`) subtree, server HTML the browser never re-creates; `hole` = a deferred
	 *  region whose current markup is the page's fallback, not a hydration tree. */
	kind: RegionKind;
	/** Index of the `<` that opens `<ogygia-region …>`. */
	start: number;
	/** Index one past the `>` that closes `</ogygia-region>`. `[start, end)` is the whole element. */
	end: number;
	/** Index one past the `>` of the OPENING tag — the first byte of the region's inner HTML. */
	innerStart: number;
	/** Index of the `<` of the CLOSING tag — one past the last byte of the inner HTML.
	 *  `[innerStart, innerEnd)` is the inner HTML a reshaping pass may edit for a lake / hole. */
	innerEnd: number;
	/** The opening tag's attributes (unquoted values). Read `wake` / `endpoint` / `entry` here. */
	attrs: Readonly<Record<string, string>>;
	/** Nesting depth — `0` for a top-level region, `1` for one directly inside a lake / hole, and so
	 *  on. Island subtrees are never entered, so a region deeper than `0` is always inside a lake or
	 *  hole (never inside another island). */
	depth: number;
}

const REGION_TAG = 'ogygia-region';

function classify(attrs: Record<string, string>): RegionKind {
	if ('endpoint' in attrs) return 'hole';
	if (attrs.wake === 'none') return 'lake';
	return 'island';
}

interface OpenFrame {
	node: RegionSpan;
	emit: boolean;
	sealed: boolean;
}

/**
 * Yield every `<ogygia-region>` in `html`, a region after the regions nested in it, an island's
 * subtree treated as atomic (its nested regions are not yielded; an island inside a lake is). One
 * linear pass; tag-like text in a comment, a raw-text element or an attribute value is never
 * counted. An unterminated region is still yielded, its span its opening tag alone.
 */
export function* scanRegions(html: string): Generator<RegionSpan, void, undefined> {
	const stack: OpenFrame[] = [];
	let i = 0;
	for (
		let at = next_open_or_close(html, REGION_TAG, 0);
		at !== null;
		at = next_open_or_close(html, REGION_TAG, i)
	) {
		if ('close' in at) {
			const frame = stack.pop();
			if (frame?.emit) {
				frame.node.innerEnd = at.close;
				frame.node.end = at.end;
				yield frame.node;
			}
			i = at.end;
			continue;
		}
		const t = at.tag;
		i = t.next;
		const parent_sealed = stack.length > 0 && stack[stack.length - 1].sealed;
		const attrs: Record<string, string> = Object.fromEntries(t.attrs);
		const kind = classify(attrs);
		const self_closing = html.charCodeAt(t.end - 2) === 47;
		const emit = !parent_sealed;
		const sealed = parent_sealed || kind === 'island';
		const node: RegionSpan = {
			kind,
			start: t.start,
			end: t.end,
			innerStart: t.end,
			innerEnd: t.end,
			attrs,
			depth: stack.length
		};
		if (self_closing) {
			if (emit) yield node;
		} else stack.push({ node, emit, sealed });
	}
	while (stack.length) {
		const frame = stack.pop()!;
		if (frame.emit) yield frame.node;
	}
}
