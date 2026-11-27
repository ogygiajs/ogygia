/** One candidate of a `srcset` / `imagesrcset`: its URL as written and where it sits in the value
 *  (`start`, `end`), and its descriptor (`640w`, `2x`; '' for none). */
export interface SrcsetCandidate {
	url: string;
	start: number;
	end: number;
	descriptor: string;
}

const space = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/** The candidates of a `srcset` value, split the way the HTML spec splits one: a URL runs to
 *  whitespace (its trailing commas dropped), and its descriptor runs to the next comma. A comma
 *  inside a URL (an image CDN's options, a `data:` URL) is the URL's. */
export function srcset_candidates(value: string): SrcsetCandidate[] {
	// @why the HTML spec splits a srcset at a comma only after whitespace or at a URL's end: a comma inside a URL is the URL's (test: test/browser/head-urls.test.ts › a candidate URL with a comma inside it stays one URL)
	const out: SrcsetCandidate[] = [];
	let i = 0;
	while (i < value.length) {
		while (i < value.length && (space(value.charCodeAt(i)) || value[i] === ',')) i++;
		if (i >= value.length) break;
		const start = i;
		while (i < value.length && !space(value.charCodeAt(i))) i++;
		let end = i;
		while (end > start && value[end - 1] === ',') end--;
		let descriptor = '';
		if (end === i) {
			const from = i;
			while (i < value.length && value[i] !== ',') i++;
			descriptor = value.slice(from, i).trim();
		}
		out.push({ url: value.slice(start, end), start, end, descriptor });
	}
	return out;
}
