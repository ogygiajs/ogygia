// The region splitter's hand-written attribute scan answers exactly what the regex it replaced did —
// checked against the original pattern over fuzzed inputs (quotes, case, Unicode spaces).
import { describe, expect, it } from 'vitest';
import { parse_attr_string, scanRegions } from '../src/split-regions.ts';

function fuzz(n: number, pieces: string[], seed = 1): string[] {
	let s = seed;
	const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		let x = '';
		const len = 1 + Math.floor(rnd() * 14);
		for (let k = 0; k < len; k++) x += pieces[Math.floor(rnd() * pieces.length)];
		out.push(x);
	}
	return out;
}

describe('regex replacements answer what the regex did', () => {
	it('region attribute parsing (the regex rules, quirks included)', () => {
		const re = /([^\s/>=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s/>]+))?/g;
		const ref = (inner: string) => {
			const attrs: Record<string, string> = {};
			re.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = re.exec(inner))) {
				let value = m[2] ?? '';
				if (value && (value[0] === '"' || value[0] === "'")) value = value.slice(1, -1);
				attrs[m[1].toLowerCase()] = value;
			}
			return attrs;
		};
		const pieces = [
			' entry="./a.js"',
			" wake='none'",
			' endpoint=/x',
			' a',
			'=',
			' = ',
			'"',
			"'",
			' b="q>w"',
			' C=D',
			" e='f",
			' data-x = "y z"',
			'   ',
			' g=/',
			' h= ',
			' ',
			'Ü=1',
			'>',
			'/'
		];
		for (const inner of fuzz(6000, pieces, 7)) expect(parse_attr_string(inner)).toEqual(ref(inner));
		// and through the scan, on a well-formed tag
		const [span] = [
			...scanRegions('<ogygia-region entry="./a.js" WAKE=none data-x = "y z"></ogygia-region>')
		];
		expect(span.attrs).toEqual({ entry: './a.js', wake: 'none', 'data-x': 'y z' });
	});
});
