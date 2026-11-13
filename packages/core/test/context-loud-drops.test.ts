import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { record_ctx, set_ctx_recorder } from '../src/context-registry.ts';
import { serialize_context, serialize_provided_context } from '../src/context-bridge.ts';

let warns: string[] = [];
let recorded: unknown[] = [];
const orig = console.warn;

beforeEach(() => {
	warns = [];
	recorded = [];
	console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(' '));
	set_ctx_recorder((name) => void recorded.push(name));
});
afterEach(() => {
	console.warn = orig;
	set_ctx_recorder(null);
});

describe('a context that cannot cross into regions is said, not dropped silently', () => {
	it('a one-off Symbol() key set for regions is refused with a code that names it', () => {
		record_ctx(Symbol('rt'), { a: 1 });
		expect(recorded).toEqual([]);
		expect(warns.join('\n')).toMatch(/context_key_one_off/);
		expect(warns.join('\n')).toMatch(/Symbol\(rt\)/);
	});

	it('a bare function set for regions is refused with a code that points at a wired class', () => {
		record_ctx('track', () => {});
		expect(recorded).toEqual([]);
		expect(warns.join('\n')).toMatch(/context_value_function/);
	});

	it('a key marked { islands: false } is kept off the page and says nothing', () => {
		record_ctx(Symbol('rt'), 1, { islands: false });
		record_ctx('track', () => {}, { islands: false });
		expect(recorded).toEqual([]);
		expect(warns).toEqual([]);
	});

	it('a Provide holding a one-off Symbol() key says it cannot cross', () => {
		serialize_context({ [Symbol('rt')]: 1, theme: 'dark' });
		expect(warns.join('\n')).toMatch(/context_key_one_off/);
	});

	it('a value holding a function inside it is dropped with a code', () => {
		const payload = serialize_provided_context(
			new Map<string, unknown>([
				['rt', { go: () => {} }],
				['keep', 1]
			])
		);
		expect(payload).toBeTruthy();
		expect(warns.join('\n')).toMatch(/context_unserializable|context_dropped/);
	});
});
