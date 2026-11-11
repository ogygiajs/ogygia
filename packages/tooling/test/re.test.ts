// The shared e2e regexes: a `_G_RE` name says the pattern is global, so a spec can tell from the
// name alone whether `.test()` is safe on it.
import { describe, expect, it } from 'vitest';
import * as re from '../src/e2e/re.ts';

describe('the shared e2e regexes', () => {
	it('every export is a regex, global exactly when its name ends in _G_RE', () => {
		const wrong = Object.entries(re)
			.filter(([name, value]) => {
				if (!(value instanceof RegExp)) return true;
				return value.global !== name.endsWith('_G_RE');
			})
			.map(([name]) => name);
		expect(wrong).toEqual([]);
	});
});
