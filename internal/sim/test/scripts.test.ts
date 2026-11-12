// A script runs once, as in a browser (src/happy.ts). A copy of a script carries its "already
// started" flag (HTML's cloning steps), and a script a parser marked unexecutable (`DOMParser`) or
// that already ran is started: its copy never runs. happy-dom ran the copy, so a client
// navigation's head merge ran the next page's early hole start, and every `load` hole of the page
// was fetched again after the batch had brought it (gen 191, seed 191001).
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { scripts_start_once } from '../src/happy.ts';

const page = () => {
	scripts_start_once();
	const w = new Window({ settings: { enableJavaScriptEvaluation: true } });
	w.document.write('<html><head></head><body></body></html>');
	return w as unknown as Window & { ran?: number };
};

describe('a script', () => {
	it("a copy of a parsed page's script does not run in the page", () => {
		const w = page();
		const parsed = new w.DOMParser().parseFromString(
			'<html><head><script>window.ran = (window.ran ?? 0) + 1</script></head></html>',
			'text/html'
		);
		w.document.head.append(parsed.head.querySelector('script')!.cloneNode(true));
		expect(w.ran).toBeUndefined();
	});

	it('a copy of one that ran does not run again; a made one runs, once', () => {
		const w = page();
		const made = w.document.createElement('script');
		made.textContent = 'window.ran = (window.ran ?? 0) + 1';
		const copy = made.cloneNode(true);
		w.document.head.append(made);
		expect(w.ran).toBe(1);
		w.document.head.append(made.cloneNode(true));
		expect(w.ran).toBe(1);
		// (a copy made before its original ran was never started: it runs)
		w.document.head.append(copy);
		expect(w.ran).toBe(2);
	});
});
