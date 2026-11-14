// Type tests: `tsc -p test` (the package's `check`) fails when a line marked @ts-expect-error
// compiles, or when an expectTypeOf does not hold. The bodies under `compile_only` never run.
import type { Handle, RequestEvent } from '@sveltejs/kit';
import { describe, expectTypeOf, it } from 'vitest';
import {
	rewrite,
	type Rewrite,
	type RewriteCheck,
	type RewriteContext,
	type RewriteElement,
	type RewriteSheet,
	type WholePageRewrite
} from '../src/index.ts';

function compile_only(body: () => void): void {
	void body;
}

describe('rewrite()', () => {
	it('an element rewrite is a Kit handle with .check(); a page rewrite also has .html()', () => {
		const el = rewrite({ match: 'x-', render: (els) => els.map((e) => e.html) });
		const page = rewrite({ page: (html) => html });
		expectTypeOf(el).toEqualTypeOf<Rewrite>();
		expectTypeOf(el).toExtend<Handle>();
		expectTypeOf(page).toEqualTypeOf<WholePageRewrite>();
		expectTypeOf(el.check).returns.resolves.toEqualTypeOf<RewriteCheck>();
		expectTypeOf(page.html).returns.resolves.toEqualTypeOf<string>();
	});

	it('render gets the elements and the context, and gives one result per element, sync or async', () => {
		expectTypeOf<RewriteContext>().toEqualTypeOf<{
			kind: 'document' | 'region';
			csr: boolean;
			url: URL;
			event: RequestEvent;
			signal: AbortSignal;
		}>();
		expectTypeOf<RewriteElement>().toEqualTypeOf<{
			readonly name: string;
			readonly html: string;
			readonly restored: boolean;
		}>();
		compile_only(() => {
			rewrite({ match: ['x-a', 'x-b'], render: async (els) => els.map((e) => ({ html: e.html })) });
			rewrite({
				match: (name) => name.startsWith('x-'),
				render: (els) =>
					els.map((e) => ({ html: e.html, sheets: [{ key: 'k', css: '', scope: 'shadow' }] }))
			});
			// @ts-expect-error a sheet's scope is page or shadow
			const bad_scope: RewriteSheet = { key: 'k', css: '', scope: 'host' };
			void bad_scope;
			// @ts-expect-error render gives results back, never nothing
			rewrite({ match: 'x-', render: () => undefined });
			// @ts-expect-error an element rewrite has no .html()
			rewrite({ match: 'x-', render: (els) => els.map((e) => e.html) }).html('a');
		});
	});
});
