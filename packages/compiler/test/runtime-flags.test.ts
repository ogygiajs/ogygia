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

const RUNTIME_DIR = '/app/node_modules/@ogygia/core/dist/runtime';

const flag = (marks: RuntimeMarks, all = false) =>
	/FRAMES = (true|false)/.exec(generateRuntimeFlagsSource(marks, RUNTIME_DIR, all))![1] === 'true';

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

	it('the codec is imported on use only where the wire feature is out of the build', () => {
		const on_use = (marks: RuntimeMarks, all = false) =>
			/load_wire_codec = (.*);/.exec(generateRuntimeFlagsSource(marks, RUNTIME_DIR, all))![1];
		expect(on_use({ complete: true, hydrate: ['load'] })).toBe(
			`() => import("${RUNTIME_DIR}/../live-transport.js")`
		);
		// a build with the codec has no import() of it in the boot's graph: that edge alone would
		// split the boot's shared chunk (apps/palaestra/e2e/lazy-chunks.spec.ts)
		expect(on_use({ complete: true, hydrate: ['load'], wire: true })).toBe('null');
		expect(on_use({})).toBe('null');
		expect(on_use({ complete: true, hydrate: ['load'] }, true)).toBe('null');
	});

	it('incomplete marks and dev keep every flag on', () => {
		expect(flag({})).toBe(true);
		expect(flag({ complete: true, hydrate: ['load'] }, true)).toBe(true);
	});
});
