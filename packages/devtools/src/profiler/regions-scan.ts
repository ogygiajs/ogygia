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
 * Yield every `<ogygia-region>` in `html`, in document order, an island's subtree treated as atomic
 * (its nested regions are not yielded). One linear pass, O(html length); allocates no copy of the
 * document. Tag-like text in a comment, a raw-text element or an attribute value is never counted.
 */
export function* scanRegions(html: string): Generator<RegionSpan, void, undefined> {
	const stack: OpenFrame[] = [];
	// (core's tag walk: comments, raw-text elements' text and quoted values hold no tag, as the
	// browser reads them; one linear pass)
	let i = 0;
	for (
		let at = next_open_or_close(html, REGION_TAG, 0);
		at !== null;
		at = next_open_or_close(html, REGION_TAG, i)
	) {
		// Closing `</ogygia-region>`.
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
		// Opening `<ogygia-region …>`: its attributes as the browser keeps them (the first of two).
		{
			const t = at.tag;
			i = t.next;
			const parent_sealed = stack.length > 0 && stack[stack.length - 1].sealed;
			const attrs: Record<string, string> = Object.fromEntries(t.attrs);
			const kind = classify(attrs);
			const self_closing = html.charCodeAt(t.end - 2) === 47;
			// Emit this region unless it is STRICTLY INSIDE an island (a nested login island in a
			// header lake IS emitted — the caller must protect it). Its own subtree is sealed when it
			// is an island, or when it already sits inside one.
			const emit = !parent_sealed;
			const sealed = parent_sealed || kind === 'island';
			const node: RegionSpan = {
				kind,
				start: t.start,
				end: t.end, // filled at the close; a self-closed / unterminated region keeps this
				innerStart: t.end,
				innerEnd: t.end,
				attrs,
				depth: stack.length
			};
			if (self_closing) {
				if (emit) yield node; // no subtree to seal
			} else {
				stack.push({ node, emit, sealed });
			}
		}
	}
	// Unterminated regions (malformed HTML) drain here without a close — surfaced with their
	// parse-time `end`/`innerEnd` so a caller never loses a region silently.
	while (stack.length) {
		const frame = stack.pop()!;
		if (frame.emit) yield frame.node;
	}
}
