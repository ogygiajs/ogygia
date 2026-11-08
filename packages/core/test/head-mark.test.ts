/**
 * The head mark (runtime/session.ts `mark_head`): what one island's hydrate step put in `<head>`,
 * read from a MutationObserver's records, and from a copy of the head where there is none. Both give
 * what a scan of the head before and after gives, in head order. The browser test
 * (test/browser/head-ownership.test.ts) checks the same on a real head; this one runs on the DOM stub
 * the bench files use.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { document, el } from './_stubs/dom.ts';
import { RuntimeSession } from '../src/runtime/session.ts';

const g = globalThis as { MutationObserver?: unknown };
const saved = g.MutationObserver;
let s: RuntimeSession;

beforeEach(() => {
	s = new RuntimeSession();
	document.head.replaceChildren(
		el('<meta charset="utf-8">'),
		el('<title>Page</title>'),
		el('<style>a{}</style>')
	);
	s.adopt_document_head();
});
afterEach(() => {
	g.MutationObserver = saved;
});

const names = (els: Element[]) => els.map((e) => e.getAttribute('name') ?? e.localName);

for (const observer of [true, false]) {
	describe(observer ? 'with MutationObserver' : 'without MutationObserver', () => {
		beforeEach(() => {
			if (!observer) delete g.MutationObserver;
		});

		it('what the step added, in head order, and not what it moved or took back', () => {
			const mark = s.mark_head();
			const head = document.head as unknown as Element;
			const end = el('<meta name="end">');
			head.appendChild(end as unknown as Node);
			head.insertBefore(el('<meta name="before-end">') as unknown as Node, end as unknown as Node);
			head.insertBefore(el('<meta name="first">') as unknown as Node, head.firstChild);
			head.appendChild(head.children[2]); // one of the page's own, moved
			const gone = el('<meta name="gone">');
			head.appendChild(gone as unknown as Node);
			(gone as unknown as Element).remove();
			expect(names(mark.added())).toEqual(['first', 'before-end', 'end']);
			mark.stop();
		});

		it('a record handed to the observer before the step is read still counts', async () => {
			const mark = s.mark_head();
			document.head.appendChild(el('<meta name="late">'));
			await Promise.resolve();
			expect(names(mark.added())).toEqual(['late']);
		});

		it('the record makes the added elements the island’s and retires the page copy', () => {
			document.head.appendChild(el('<meta name="og" content="x">'));
			s.adopt_document_head();
			const mark = s.mark_head();
			const live = el('<meta name="og" content="x">');
			document.head.appendChild(live);
			s.record_island_head(mark);
			expect([...s.island_head]).toEqual([live]);
			expect(document.head.children.filter((e) => e.getAttribute('name') === 'og')).toEqual([live]);
		});

		it('stop() ends the mark: nothing is noted after it', () => {
			const mark = s.mark_head();
			mark.stop();
			expect(Array.isArray(mark.added())).toBe(true);
		});
	});
}
