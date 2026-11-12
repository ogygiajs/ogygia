// RUNTIME FLAGS (`ogygia:boot/runtime-flags`): build-time constants for code that lives inside the
// always-on region element. `FRAMES` follows the `frames` feature exactly — the element's fetch /
// apply / morph path is only ever reached through the frame store, so a build without the store
// must not ship that path, and a build with it must keep it.
import { describe, expect, it } from 'vitest';
import {
	generateRuntimeFlagsSource,
	resolveFeatures,
	type RuntimeMarks
} from '../src/compiler/link/runtime-entry.ts';

const flag = (marks: RuntimeMarks, all = false) =>
	/FRAMES = (true|false)/.exec(generateRuntimeFlagsSource(marks, all))![1] === 'true';

describe('runtime flags', () => {
	it('FRAMES is the frames feature: on wherever a region streams HTML', () => {
		const cases: RuntimeMarks[] = [
			{ complete: true, hydrate: ['load'] },
			{ complete: true, hydrate: ['load'], defer: ['load'] },
			{ complete: true, live: true },
			{ complete: true, morph: true },
			{ complete: true, lakes: true },
			{ complete: true, hydrate: ['none'] },
			{ complete: true, router: true }
		];
		for (const marks of cases)
			expect(flag(marks), JSON.stringify(marks)).toBe(resolveFeatures(marks).includes('frames'));
		expect(flag({ complete: true, hydrate: ['load'] })).toBe(false);
		expect(flag({ complete: true, defer: ['visible'] })).toBe(true);
	});

	it('incomplete marks and dev keep every flag on', () => {
		expect(flag({})).toBe(true);
		expect(flag({ complete: true, hydrate: ['load'] }, true)).toBe(true);
	});
});
