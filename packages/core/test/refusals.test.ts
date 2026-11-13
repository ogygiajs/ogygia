// A misuse is refused at once, by its own code: what each check below exists to say.
import { describe, expect, it } from 'vitest';
import { Html } from '../src/html.ts';
import { __register_fn, fn_handle } from '../src/fn-transport.ts';
import { resolve } from '../src/ref.ts';
import {
	__register_transportable,
	reduce_transportable,
	revive_transportable,
	wire
} from '../src/live-transport.ts';
import { script } from '../src/script.ts';
import { mint_server_region } from '../src/server/region-endpoint.ts';
import { MAX_REGION_PROPS_LEN } from '../src/server/endpoint.ts';
import { register_derived_kind } from '../src/store-transport.ts';
import { wire_form } from '../src/transport.ts';
import { REGION_BRAND } from '../src/region-brand.ts';

function code_of(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return (error as { code?: string }).code ?? `uncoded: ${String(error)}`;
	}
	return 'not refused';
}

describe('refused by code', () => {
	it('an og.$ factory that returns no function', () => {
		__register_fn('test/refusals#$not-fn', () => 42);
		expect(code_of(() => fn_handle('test/refusals#$not-fn', []))).toBe('fn_factory_not_function');
	});

	it('a ref of a kind nobody registered', () => {
		expect(code_of(() => resolve({ k: 'test-no-such-kind', i: 'i-1' } as never, false))).toBe(
			'ref_kind_missing'
		);
	});

	it('a wire class sent without its build registration', () => {
		class Unlisted {
			static [wire] = { encode: () => 0, decode: () => new Unlisted() };
		}
		expect(code_of(() => reduce_transportable(new Unlisted()))).toBe('transportable_unregistered');
	});

	it('a wire value whose class the receiving build does not have', () => {
		class Listed {
			static [wire] = { encode: () => 0, decode: () => new Listed() };
		}
		__register_transportable('test/refusals#Listed', Listed);
		expect(
			code_of(() => revive_transportable({ t: 'test/refusals#Gone', i: 'w-1', d: 0 }, false))
		).toBe('transportable_class_missing');
	});

	it('a script whose run is not a function', () => {
		expect(code_of(() => script({ run: 'alert(1)' } as never))).toBe('script_run_not_function');
	});

	it('a module script import that is no URL', () => {
		expect(
			code_of(() => script({ run: () => 0, type: 'module', imports: { a: '' } } as never))
		).toBe('script_import_not_url');
	});

	it('a data script whose payload JSON cannot write', () => {
		expect(code_of(() => script({ json: () => 0 } as never))).toBe('script_not_json');
	});

	it('a deferred region whose props are past the address limit', () => {
		const big = 'x'.repeat(MAX_REGION_PROPS_LEN);
		expect(code_of(() => mint_server_region('src/lib/Big.svelte', { big }))).toBe(
			'hole_props_too_large'
		);
	});

	it('a plain inline region nothing awaited, made to cross', () => {
		expect(code_of(() => wire_form({ [REGION_BRAND]: true, kind: 'inline' }))).toBe(
			'held_region_plain_import'
		);
	});

	it('a derived store revived without its formula', () => {
		register_derived_kind();
		expect(
			code_of(() =>
				resolve({ k: 'derived', i: 'd-1', d: { s: [], f: null, single: false, seed: 0 } }, false)
			)
		).toBe('og_derived_formula_missing');
	});
});

it('Html is made only by its own module', () => {
	expect(
		() => new (Html as unknown as new (t: unknown, m: string) => Html)(null, '<b>x</b>')
	).toThrow(TypeError);
});
