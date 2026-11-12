// THE TAG END BY JUMPS IS THE TAG END BY STEPS (#1037). The walk finds where a tag ends by searching
// for its next `=` and `>` (`tag_end`) instead of reading each attribute a character at a time
// (`read_attrs`, which every attribute read still uses). The two must agree on every input: the
// adversarial pieces below are the cases that tell them apart (a name that starts with `=`, a `/`
// before one, an unquoted value holding `=` or a quote, a quoted one holding `>`, input that ends
// inside a tag). Generated from a fixed seed, so a failure replays.
import { expect, it } from 'vitest';
import { __tag_end_twin } from '../src/markup-walk.ts';

const PIECES = [
	'<',
	'>',
	'/',
	'=',
	'"',
	"'",
	' ',
	'\t',
	'\n',
	'\f',
	'\r',
	'a',
	'B',
	'href',
	'x="1"',
	"y='>'",
	'z=3',
	'= ',
	'==',
	'/=',
	'"="',
	'a=b=c',
	'v=x"y',
	'w = "q>"',
	'<a ',
	'</p ',
	'é'
];

function* pages(count: number): Generator<string> {
	let seed = 1037;
	const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
	for (let i = 0; i < count; i++) {
		let s = '';
		const n = Math.floor(next() * 40);
		for (let k = 0; k < n; k++) s += PIECES[Math.floor(next() * PIECES.length)];
		yield s;
	}
}

it('a tag ends where the step-by-step read ends it, from every point in every page', () => {
	for (const html of pages(20_000))
		for (let j = 0; j <= html.length; j++) {
			const steps = __tag_end_twin.steps(html, j);
			expect(__tag_end_twin.jumps(html, j), `${JSON.stringify(html)} from ${j}`).toBe(steps);
		}
});
