// Type tests: `tsc -p test` (the package's `check`) fails when a line marked @ts-expect-error
// compiles, or when an expectTypeOf does not hold. The bodies under `compile_only` never run.
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expectTypeOf, it } from 'vitest';
import { handle, type ReshapeTransform, type TransformKind } from '../src/index.ts';

/** Holds code that only has to compile (or fail to): it never runs. */
function compile_only(body: () => void): void {
	void body;
}

describe('ReshapeTransform', () => {
	it('is the one argument handle() takes', () => {
		expectTypeOf(handle).parameters.toEqualTypeOf<[ReshapeTransform]>();
	});

	it('takes the html and the kind, csr and event of the response, and gives html back, sync or async', () => {
		expectTypeOf<Parameters<ReshapeTransform>[0]>().toEqualTypeOf<string>();
		expectTypeOf<Parameters<ReshapeTransform>[1]>().toEqualTypeOf<{
			kind: TransformKind;
			csr: boolean;
			event: RequestEvent;
		}>();
		expectTypeOf<ReturnType<ReshapeTransform>>().toEqualTypeOf<string | Promise<string>>();
	});

	it('types a transform written in a module of its own, which handle() accepts as is', () => {
		compile_only(() => {
			const sync: ReshapeTransform = (html, { kind }) => (kind === 'region' ? html : html.trim());
			const later: ReshapeTransform = async (html) => html;
			handle(sync);
			handle(later);
			// @ts-expect-error a transform hands html back, never nothing
			const nothing: ReshapeTransform = () => undefined;
			// @ts-expect-error the kind is 'document' or 'region'
			const unknown_kind: ReshapeTransform = (html, { kind }) => (kind === 'page' ? html : html);
			void nothing;
			void unknown_kind;
		});
	});
});
