import { describe, expect, it } from 'vitest';
import { parse } from 'devalue';
import { key_label, key_name, key_of } from '../src/contract/context-key.ts';
import {
	crossing_values,
	serialize_context,
	serialize_provided_context
} from '../src/context-bridge.ts';

const STRINGS = ['', 'theme', 's', '\0', '\0s', '\0srt', '\0k', '\0kx', '\0\0', 'Symbol.for(rt)'];

describe('a context key that crosses', () => {
	it('a string key crosses as itself and comes back the same string', () => {
		for (const s of STRINGS) {
			const name = key_name(s);
			expect(name).not.toBeNull();
			expect(key_of(name!)).toBe(s);
		}
		expect(key_name('theme')).toBe('theme');
	});

	it('a Symbol.for key comes back as the same shared symbol', () => {
		for (const s of STRINGS) {
			const name = key_name(Symbol.for(s));
			expect(name).not.toBeNull();
			expect(key_of(name!)).toBe(Symbol.for(s));
		}
	});

	it('no string key crosses under the name of a shared symbol', () => {
		const names = new Set(STRINGS.map((s) => key_name(s)));
		for (const s of STRINGS) expect(names.has(key_name(Symbol.for(s)))).toBe(false);
	});

	it('a one-off symbol, or a key that is not a string or symbol, does not cross', () => {
		expect(key_name(Symbol('rt'))).toBeNull();
		expect(key_name(Symbol.iterator)).toBeNull();
		expect(key_name(1)).toBeNull();
		expect(key_name({})).toBeNull();
	});

	it('a key is named for a message the way it was written', () => {
		expect(key_label('theme')).toBe("'theme'");
		expect(key_label(Symbol.for('rt'))).toBe("Symbol.for('rt')");
		expect(key_label(Symbol('rt'))).toBe('Symbol(rt)');
	});

	it("a Provide's symbol-keyed values serialize under their crossing names", () => {
		const values = { theme: 'dark', [Symbol.for('rt')]: { a: 1 }, [Symbol('one-off')]: 2 };
		expect(crossing_values(values)).toEqual({
			theme: 'dark',
			[key_name(Symbol.for('rt'))!]: { a: 1 }
		});
		const back = parse(serialize_context(values)) as Record<string, unknown>;
		expect(key_of(Object.keys(back)[1])).toBe(Symbol.for('rt'));
	});

	it('the page marker carries a recorded shared-symbol name', () => {
		const name = key_name(Symbol.for('rt'))!;
		const payload = serialize_provided_context(new Map([[name, { a: 1 }]]));
		expect(parse(payload!)).toEqual({ [name]: { a: 1 } });
	});
});
