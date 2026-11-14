import MagicString from 'magic-string';
import type { EncodedSourceMap } from '@jridgewell/remapping';

/** One replacement of `src.slice(start, end)` by `text`: an insert when `start === end`. */
export interface Edit {
	start: number;
	end: number;
	text: string;
}

/** `src` with non-overlapping `edits` applied, in start order (inserts at one place in the given order). */
export function splice_text(src: string, edits: readonly Edit[]): string {
	if (!edits.length) return src;
	const sorted = [...edits].sort((a, b) => a.start - b.start);
	let out = '';
	let last = 0;
	for (const e of sorted) {
		out += src.slice(last, e.start) + e.text;
		last = e.end;
	}
	return out + src.slice(last);
}

/** The map from `splice_text(src, edits)` back to `src` (named `source`). */
export function splice_map(src: string, edits: readonly Edit[], source: string): EncodedSourceMap {
	const s = new MagicString(src);
	for (const e of [...edits].sort((a, b) => a.start - b.start)) {
		if (e.start === e.end) {
			if (e.text) s.appendLeft(e.start, e.text);
		} else if (e.text) s.overwrite(e.start, e.end, e.text);
		else s.remove(e.start, e.end);
	}
	const map = s.generateMap({ hires: true, source });
	return { version: 3, sources: map.sources, names: map.names, mappings: map.mappings };
}
