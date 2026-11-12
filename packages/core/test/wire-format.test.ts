// A side-channel script's two lanes, read back (src/runtime/wire-format.ts): the JSON lane is
// `JSON.parse`d and never asks for devalue; the devalue lane parses with the caller's revivers.
import { afterEach, expect, test, vi } from 'vitest';
import { parse, stringify } from 'devalue';
import { slots, type BootLink } from '../src/runtime/slots.ts';
import { parse_sidecar_text, parse_wire_text, wire_is_json } from '../src/runtime/wire-format.ts';

const was = slots.boot;
afterEach(() => {
	slots.boot = was;
});

/** A boot whose devalue is the real one, counting how often it is asked for. */
function boot() {
	const devalue = vi.fn(() => ({ parse }));
	slots.boot = { devalue } as unknown as BootLink;
	return { devalue };
}

/** A script element with only what the reader reads. */
const script = (text: string, format?: string) =>
	({
		textContent: text,
		getAttribute: (name: string) => (name === 'data-og-format' ? (format ?? null) : null)
	}) as unknown as Element;

test('a script marked data-og-format="json" is the JSON lane; any other is not', () => {
	expect(wire_is_json(script('{}', 'json'))).toBe(true);
	expect(wire_is_json(script('{}'))).toBe(false);
	expect(wire_is_json(script('{}', 'devalue'))).toBe(false);
});

test('the JSON lane is parsed as JSON and never asks for devalue', () => {
	const { devalue } = boot();
	expect(parse_sidecar_text(script('{"a":[1,2]}', 'json'))).toEqual({ a: [1, 2] });
	expect(devalue).not.toHaveBeenCalled();
});

test('the devalue lane is parsed by devalue with the caller’s revivers', () => {
	boot();
	class Money {
		constructor(readonly cents: number) {}
	}
	const text = stringify(
		{ at: new Date(0), price: new Money(250) },
		{
			Money: (v: unknown) => v instanceof Money && [v.cents]
		}
	);
	const out = parse_wire_text(text, false, {
		Money: ([cents]: [number]) => new Money(cents)
	}) as { at: Date; price: Money };
	expect(out.at).toBeInstanceOf(Date);
	expect(out.price).toBeInstanceOf(Money);
	expect(out.price.cents).toBe(250);
});
