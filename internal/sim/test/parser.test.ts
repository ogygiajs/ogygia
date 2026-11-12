// A document's text is parsed as a browser parses it (src/happy.ts, `whole_text_runs`): one text
// node per run of text. happy-dom's parser cut a run at a bare `>` into two text nodes, and an
// island whose server HTML said `() => …` failed to hydrate on every load (seed 477, /boundary-lab).
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { whole_text_runs } from '../src/happy.ts';

describe('the document parser', () => {
	it('a bare > in text stays in one text node', () => {
		whole_text_runs();
		const w = new Window();
		w.document.write('<html><body><p>a: () => b > c</p></body></html>');
		const p = w.document.querySelector('p')!;
		expect([...p.childNodes].map((n) => n.textContent)).toEqual(['a: () => b > c']);
	});

	it('so does a fragment parse', () => {
		whole_text_runs();
		const w = new Window();
		const div = w.document.createElement('div');
		div.innerHTML = 'x > y<b>z</b>';
		expect([...div.childNodes].map((n) => n.textContent)).toEqual(['x > y', 'z']);
	});
});
