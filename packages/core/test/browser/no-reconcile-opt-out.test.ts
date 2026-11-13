// AN AUTHOR OPTS A PAGE OUT OF THE IN-PLACE RECONCILE with `data-og-no-reconcile`, on any element
// of its body, the `<body>` itself included: the router then swaps the whole body instead.
import { expect, test } from 'vitest';
import { opts_out_of_reconcile } from '../../src/runtime/reconcile.ts';

function parsed_body(html: string, attrs = ''): HTMLElement {
	return new DOMParser().parseFromString(
		`<!doctype html><body ${attrs}>${html}</body>`,
		'text/html'
	).body;
}

test('a page with no opt-out is reconciled', () => {
	expect(opts_out_of_reconcile(parsed_body('<main>page</main>'))).toBe(false);
});

test('an element in the body that opts out opts the page out', () => {
	expect(opts_out_of_reconcile(parsed_body('<main data-og-no-reconcile>page</main>'))).toBe(true);
});

test('data-og-no-reconcile on <body> itself opts the page out', () => {
	expect(opts_out_of_reconcile(parsed_body('<main>page</main>', 'data-og-no-reconcile'))).toBe(
		true
	);
});
